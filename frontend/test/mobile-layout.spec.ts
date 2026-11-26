import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

// Synthetic data, with every API call intercepted: these tests never change the live database.
const payment = { id: 1, pilgrim_id: 1, amount_usd: 450, payment_method: 'نقدًا', payment_date: '2027-01-02', cash_denominations: [], first_name_ar: 'عبد الرحمن', father_name_ar: 'محمد', last_name_ar: 'الدمشقي', trip_name: 'رحلة العمرة لشهر رجب' };
const pilgrim = { id: 1, trip_id: 1, first_name_ar: 'عبد الرحمن', father_name_ar: 'محمد عبد الكريم', last_name_ar: 'الدمشقي', first_name_en: 'Abdulrahman', father_name_en: 'Mohammed', last_name_en: 'Al Dimashqi', nationality: 'سوريا', passport_number: 'TEST1234567', passport_expiry_date: '2030-12-31', date_of_birth: '1990-04-03', origin_city: 'دمشق', destination_city: 'مكة المكرمة', gender: 'ذكر', total_received: 450, payment_status: 'لديه دفعات', payments: [payment] };
const trip = { id: 1, name: 'رحلة العمرة لشهر رجب من دمشق إلى مكة المكرمة', trip_date: '2027-01-15', trip_cost_usd: 1200, total_received: 450, net_trip: -750, pilgrim_count: 1, vehicle_number: '12345', driver_one_name: 'سائق تجريبي', driver_two_name: 'سائق تجريبي ثانٍ', pilgrims: [pilgrim] };
const pagination = { page: 1, limit: 10, total: 12, totalPages: 2 };

test.beforeEach(async ({ page }, testInfo) => {
  await page.addInitScript(role => { localStorage.setItem('token', 'isolated-ui-test'); localStorage.setItem('user', JSON.stringify({id:1,username:'UI test',role})); }, testInfo.title.startsWith('employee ') ? 'employee' : 'admin');
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname;
    let json: unknown;
    if (endpoint === '/api/dashboard/stats') json = {totalTrips:12,totalPilgrims:340,totalReceived:12345,totalTripCost:7500,upcomingTrips:4,pilgrimsWithPayments:300,pilgrimsWithoutPayments:40};
    else if (endpoint === '/api/trips') json = {trips:[trip],pagination};
    else if (endpoint === '/api/trips/1') json = trip;
    else if (endpoint === '/api/trips/1/manifest') json = {trip,pilgrims:[pilgrim]};
    else if (endpoint === '/api/pilgrims/1') json = pilgrim;
    else if (endpoint === '/api/payments') json = {payments:[payment],pagination,totalAmount:450,summary:{totalAmount:450,cashTotal:450,shamCashTotal:0}};
    else if (endpoint === '/api/reports/summary') json = {total_trips:12,total_pilgrims:340,total_trip_cost:7500,total_received:12345,net_total:4845,with_payments:300,without_payments:40,cash_total:12000,sham_cash_total:345};
    else if (endpoint === '/api/reports/nationalities') json = [{nationality:'سوريا',count:340}];
    else if (endpoint === '/api/reports/trips' || endpoint === '/api/reports/by-trip') json = [trip];
    else if (endpoint === '/api/ocr/health') json = {modes:{local:{status:'available'},cloud:{status:'configured'}}};
    else if (endpoint === '/api/auth/employees') json = {employees:[]};
    else throw new Error('Unexpected API in UI test: ' + endpoint);
    await route.fulfill({json});
  });
});

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const nav = page.getByRole('navigation', {name:'التنقل الرئيسي للهاتف'});
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test('employee screens keep operational actions and hide all payment views and exports', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const financialText = /دفعات|دفعة|المقبوض|حالة الدفع|الصافي|صافي الرحلة|تكلفة الرحلة|تكاليف الرحلات|شام كاش|رصيد الأفراد|الرصيد المستحق/;
  for (const route of ['dashboard', 'trips', 'trips/1', 'pilgrims/1', 'reports', 'settings']) {
    await page.goto('/#/' + route);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('.spinner')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(financialText);
    await expect(page.locator('a[href="#/payments"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'حسابات الموظفين' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'تصدير نسخة احتياطية' })).toHaveCount(0);
    await fits(page);
    if (route === 'trips/1') await expect(page.getByRole('button', { name: /إضافة معتمر$/ })).toBeVisible();
    if (route === 'pilgrims/1') await expect(page.getByRole('button', { name: /تعديل/ }).first()).toBeVisible();
  }
  await page.goto('/#/reports');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /تصدير/ }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv).toContain('إجمالي المعتمرين');
  expect(csv).not.toMatch(financialText);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('main')).not.toContainText(financialText);
  await page.emulateMedia({ media: 'screen' });
  await page.goto('/#/payments');
  await expect(page).toHaveURL(/#\/dashboard$/);
});

test('manager creates an employee from settings on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  let submitted: unknown;
  await page.route('**/api/auth/employees', async route => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { user: { id: 2, username: 'موظف تجريبي', role: 'employee' } } });
    } else await route.fulfill({ json: { employees: [] } });
  });
  await page.goto('/#/settings');
  await page.getByLabel('اسم مستخدم الموظف').fill('موظف تجريبي');
  await page.getByLabel('كلمة مرور الموظف', { exact: false }).first().fill('Synthetic-password-2027');
  await page.getByLabel('تأكيد كلمة مرور الموظف').fill('Synthetic-password-2027');
  await page.getByRole('button', { name: 'إضافة حساب موظف' }).click();
  await expect(page.getByRole('status')).toContainText('تم إنشاء حساب الموظف');
  expect(submitted).toEqual({ username: 'موظف تجريبي', password: 'Synthetic-password-2027', confirmPassword: 'Synthetic-password-2027' });
  await expect(page.locator('#employee-password')).toHaveValue('');
  await expect(page.getByRole('listitem')).toContainText('موظف تجريبي');
  await expect(page.getByRole('button', { name: 'تصدير نسخة احتياطية' })).toBeVisible();
  await fits(page);
  await page.screenshot({ path: path.resolve('../mobile/artifacts/qa/employee-accounts-390.png'), fullPage: true });
});

for (const width of [320, 360, 390, 430, 844]) {
  test(`all screens fit ${width}px without horizontal overflow`, async ({page}) => {
    await page.setViewportSize({width,height:width > 500 ? 430 : 844});
    for (const route of ['dashboard','trips','trips/1','pilgrims/1','payments','reports','settings','trips/1/manifest']) {
      await page.goto('/#/' + route);
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('.spinner')).toHaveCount(0);
      await fits(page);
      if (width === 390 && ['trips','dashboard','pilgrims/1'].includes(route)) await page.screenshot({path:path.resolve('../mobile/artifacts/qa',route.replaceAll('/','-')+'-390.png'),fullPage:true});
    }
  });
}

test('passport form has one column, reachable footer, keyboard space and modal focus handling', async ({page}) => {
  await page.setViewportSize({width:390,height:780});
  await page.goto('/#/trips/1');
  const opener = page.getByRole('button',{name:/إضافة معتمر$/});
  await opener.click();
  const dialog = page.getByRole('dialog',{name:'إضافة معتمر جديد'});
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.ocr-actions button')).toHaveCount(2);
  expect(await dialog.locator('.responsive-grid').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
  await page.screenshot({path:path.resolve('../mobile/artifacts/qa/passport-form-390.png')});
  await page.setViewportSize({width:390,height:400});
  const notes = dialog.locator('textarea');
  await notes.focus();
  await notes.fill('اختبار مساحة لوحة المفاتيح');
  const footer = await dialog.locator('.modal-footer').boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(401);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const area = await notes.boundingBox();
  expect(area!.y + area!.height).toBeLessThanOrEqual(footer!.y + 1);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('trip and payment dialogs fit 320px and desktop tables and printing keep columns', async ({page}) => {
  await page.setViewportSize({width:320,height:640});
  await page.goto('/#/dashboard');
  await page.getByRole('link',{name:/إضافة رحلة جديدة/}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/#/pilgrims/1');
  await page.getByRole('button',{name:/إضافة دفعة/}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1280,height:800});
  await page.goto('/#/trips');
  await expect(page.locator('.app-sidebar')).toBeVisible();
  await expect(page.locator('.app-bottom-nav')).not.toBeVisible();
  expect(await page.locator('table').evaluate(el => getComputedStyle(el).display)).toBe('table');
  await page.getByRole('button',{name:/إضافة رحلة$/}).click();
  const desktopDialog = await page.getByRole('dialog').boundingBox();
  expect(desktopDialog!.width).toBeLessThanOrEqual(600);
  expect(desktopDialog!.height).toBeLessThanOrEqual(752);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:780});
  await page.goto('/#/trips/1/manifest');
  await page.emulateMedia({media:'print'});
  await expect(page.locator('.app-bottom-nav')).not.toBeVisible();
  expect(await page.locator('table').evaluate(el => getComputedStyle(el).display)).toBe('table');
});

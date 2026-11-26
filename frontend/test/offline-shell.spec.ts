import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const shell = fs.readFileSync(path.resolve('../mobile/.web-build/offline.html'), 'utf8');
const trip = { id: 7, name: 'رحلة محفوظة للاختبار', trip_date: '2027-01-01', trip_cost_usd: 1200, total_received: 450, pilgrim_count: 1 };
test.use({ viewport: { width: 390, height: 844 } });

test('bundled interface opens on first launch with all networking disabled', async ({ page, context }) => {
  const externalAssets: string[] = [];
  page.on('request', request => { if (!request.url().endsWith('/offline') && !request.url().includes('/api/')) externalAssets.push(request.url()); });
  await page.route('**/offline', route => route.fulfill({ contentType: 'text/html', body: shell }));
  await context.setOffline(true);
  await page.goto('/offline');
  await expect(page.getByRole('button', { name: 'فتح الواجهات دون اتصال' })).toBeVisible();
  await page.getByRole('button', { name: 'فتح الواجهات دون اتصال' }).click();
  await expect(page.locator('main h1')).toHaveText('لوحة التحكم');
  await expect(page.getByRole('status')).toContainText('عرض الواجهات دون اتصال');
  const nav = page.getByRole('navigation', { name: 'التنقل الرئيسي للهاتف' });
  await nav.getByRole('link', { name: 'الإعدادات' }).click();
  await page.locator('main').getByRole('button', { name: /الوضع الليلي/ }).click();
  expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
  await nav.getByRole('link', { name: 'الرحلات' }).click();
  await page.getByRole('button', { name: /إضافة رحلة$/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(externalAssets).toEqual([]);
  expect(await page.locator('.app-brand img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: path.resolve('../mobile/artifacts/qa/offline-first-launch.png'), fullPage: true });
});

test('cached operational data survives restart, excludes finance, blocks writes, reconnects and stays account-scoped', async ({ page, context }) => {
  let writes = 0;
  let onlineName = trip.name;
  await page.route('**/offline', route => route.fulfill({ contentType: 'text/html', body: shell }));
  await page.addInitScript(() => {
    if (!localStorage.getItem('user')) {
      localStorage.setItem('token', 'synthetic-offline-test');
      localStorage.setItem('user', JSON.stringify({ id: 2, username: 'موظف تجريبي', role: 'employee' }));
    }
  });
  await page.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') { writes++; await route.fulfill({ json: {} }); return; }
    const endpoint = new URL(route.request().url()).pathname;
    await route.fulfill({ json: endpoint === '/api/health' ? { status: 'ok' } : endpoint === '/api/trips' ? { trips: [{ ...trip, name: onlineName }], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } } : { totalTrips: 1, totalReceived: 450, totalTripCost: 1200 } });
  });
  await page.goto('/offline#/trips');
  await expect(page.getByRole('link', { name: trip.name })).toBeVisible();
  const stored = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('mang-read-cache')).map(key => localStorage.getItem(key)).join(''));
  expect(stored).not.toMatch(/total_received|trip_cost_usd|payments/);
  await context.setOffline(true);
  // Abort API requests explicitly too: route fixtures otherwise override offline emulation.
  await page.route('**/api/**', route => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByRole('status')).toContainText('دون اتصال');
  await expect(page.getByRole('link', { name: trip.name })).toBeVisible();
  await page.getByRole('button', { name: /إضافة رحلة$/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="text"]').fill('تغيير غير مرسل');
  await dialog.locator('input[type="date"]').fill('2027-01-02');
  await Promise.all([
    page.waitForEvent('dialog').then(async message => { expect(message.message()).toContain('تحتاج اتصالًا'); await message.accept(); }),
    dialog.locator('button[type="submit"]').click(),
  ]);
  expect(writes).toBe(0);
  await page.keyboard.press('Escape');
  onlineName = 'رحلة محدثة بعد الاتصال';
  await page.unroute('**/api/**');
  await page.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/health' ? { status: 'ok' } : { trips: [{ ...trip, name: onlineName }], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } } }));
  await context.setOffline(false);
  await expect(page.getByRole('link', { name: onlineName })).toBeVisible();
  await context.setOffline(true);
  await page.route('**/api/**', route => route.abort('internetdisconnected'));
  await page.evaluate(() => localStorage.setItem('user', JSON.stringify({ id: 3, username: 'موظف آخر', role: 'employee' })));
  await page.reload();
  await expect(page.getByRole('link', { name: onlineName })).toHaveCount(0);
  await expect(page.getByRole('link', { name: trip.name })).toHaveCount(0);
});

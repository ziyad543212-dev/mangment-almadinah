const form = document.getElementById('configuration-form');
const button = document.getElementById('submit-button');
const status = document.getElementById('status');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = 'جارٍ التحقق من الإعدادات وحفظها...';

  try {
    await window.desktopSetup.save({
      DATABASE_URL: form.elements.databaseUrl.value.trim(),
      JWT_SECRET: form.elements.jwtSecret.value
    });
    status.textContent = 'تم الحفظ. جارٍ الاتصال بقاعدة البيانات...';
  } catch (error) {
    status.textContent = error.message || 'تعذر حفظ الإعدادات.';
    button.disabled = false;
  }
});

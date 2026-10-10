# دليل النشر على Vercel و Render

## الخطوة 1: نشر Backend على Render

1. **أنشئ حساب على Render.com**
   - انتقل إلى [render.com](https://render.com)
   - سجل حساب جديد

2. **اتصل بمستودع GitHub**
   - تأكد أن المشروع على GitHub
   - اضغط "New +" في Render
   - اختر "Web Service"
   - قم بربط مستودع `mangment-almadinah`

3. **إعدادات البناء**
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `node src/server.js`
   - **Environment:** Node

4. **إعدادات البيئة**
   - `NODE_ENV`: `production`
   - `PORT`: `3001`
   - `DATABASE_URL`: سيتم إنشاؤه تلقائياً من قاعدة البيانات

5. **إضافة قاعدة بيانات PostgreSQL**
   - اختر "New +"
   - اختر "PostgreSQL"
   - الاسم: `almadinah-db`
   - سيعطيك Render رابط قاعدة البيانات (DATABASE_URL)

6. **نشر التطبيق**
   - اضغط "Create Web Service"
   - انتظر حتى يكتمل النشر
   - ستحصل على رابط مثل: `https://almadinah-backend.onrender.com`

## الخطوة 2: نشر Frontend على Vercel

1. **أنشئ حساب على Vercel**
   - انتقل إلى [vercel.com](https://vercel.com)
   - سجل حساب جديد

2. **نشر المشروع**
   - اضغط "Add New Project"
   - اختر مستودع `mangment-almadinah`
   - في إعدادات المشروع:
     - **Root Directory:** `frontend`
     - **Framework Preset:** Vite
     - **Build Command:** `npm run build`
     - **Output Directory:** `dist`

3. **إعدادات البيئة**
   - أضف متغير البيئة:
     - `VITE_API_URL`: رابط Backend من Render
     - مثال: `https://almadinah-backend.onrender.com`

4. **نشر التطبيق**
   - اضغط "Deploy"
   - انتظر حتى يكتمل النشر
   - ستحصل على رابط مثل: `https://almadinah.vercel.app`

## الخطوة 3: تحديث المتغيرات

بعد الحصول على الروابط:
1. عد إلى إعدادات Render
2. تأكد أن `DATABASE_URL` مضبوط بشكل صحيح
3. عد إلى إعدادات Vercel
4. حدّث `VITE_API_URL` برابط Backend الصحيح
5. أعد نشر Frontend

## الخطوة 4: إنشاء مستخدم مسؤول

بعد نشر Backend:
1. افتح Postman أو متصفح
2. أرسل POST إلى: `https://almadinah-backend.onrender.com/api/auth/setup-admin`
3. في Body (JSON):
```json
{
  "username": "admin",
  "password": "yourpassword"
}
```

## فحص النشر

1. **Backend:**
   - افتح: `https://almadinah-backend.onrender.com/api/trips`
   - يجب أن ترى قائمة الرحلات (أو مصفوفة فارغة)

2. **Frontend:**
   - افتح رابط Vercel
   - يجب أن يظهر الموقع
   - جرب تسجيل الدخول

## ملاحظات مهمة

- البيانات مخزنة في PostgreSQL على Render
- النسخة المجانية من Render تقتصر على 90 يوم من الـ logs
- النسخة المجانية من Vercel غير محدودة للاستخدام الشخصي
- تأكد من عدم رفع `.env` أو قاعدة البيانات المحلية إلى GitHub

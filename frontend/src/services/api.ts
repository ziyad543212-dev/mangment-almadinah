import axios from 'axios';

const api = axios.create({
  // استخدام رابط الباك إند المحلي (بورت 3001) أو الرابط السحابي المرفوع إذا وُجد
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  headers: {
    'Content-Type': 'application/json',
  },
});

// إضافة التوكن تلقائياً لكل الطلبات التي تتطلب مصادقة
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;
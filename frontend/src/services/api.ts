import axios, { AxiosError } from 'axios';
import { mobileShell, isOffline, isPreview, setOffline, offlineResponse, rememberResponse, clearOfflineCache } from './offline';

const isElectronFileOrigin = window.location.protocol === 'file:';
const isLocalWebOrigin = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const localApiBaseUrl = 'http://localhost:3001/api';
const hostedApiBaseUrl = 'https://mangment-almadinah-2.onrender.com/api';
const desktopApiBaseUrl = (window as unknown as {
  mangDesktop?: { apiBaseUrl?: string };
}).mangDesktop?.apiBaseUrl;
const configuredApiBaseUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');

const api = axios.create({
  baseURL: window.__mangMobile?.apiBaseUrl || desktopApiBaseUrl || configuredApiBaseUrl ||
    (isElectronFileOrigin
      ? 'http://127.0.0.1:3001/api'
      : isLocalWebOrigin
        ? localApiBaseUrl
        : hostedApiBaseUrl),
  headers: {
    'Content-Type': 'application/json',
  },
});

if (mobileShell) {
  const networkAdapter = axios.getAdapter(api.defaults.adapter);
  api.defaults.adapter = async config => {
    const url = config.url || '';
    const healthCheck = url === '/health';
    const readOnly = config.method === 'get';
    const localResult = () => {
      const data = readOnly ? offlineResponse(url) : undefined;
      if (data !== undefined) return { data, status: 200, statusText: 'Offline', headers: {}, config };
      throw new AxiosError('هذه العملية تحتاج اتصالًا بالخادم. لم يتم حفظ أو إرسال أي تغيير.', 'ERR_OFFLINE', config, null,
        { data: { error: 'هذه العملية تحتاج اتصالًا بالخادم. لم يتم حفظ أو إرسال أي تغيير.' }, status: 503, statusText: 'Offline', headers: {}, config });
    };
    if (!healthCheck && (isOffline() || isPreview())) return localResult();
    try {
      const result = await networkAdapter({ ...config, timeout: config.timeout || (healthCheck ? 3000 : readOnly ? 6000 : 15000) });
      // Axios transforms JSON after the adapter, so parse before sanitizing the cache.
      let payload = result.data;
      if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
      if (healthCheck) { if (payload?.status === 'ok' && !isPreview()) setOffline(false); }
      else if (readOnly && payload && typeof payload === 'object') rememberResponse(url, payload);
      return result;
    } catch (failure) {
      if (axios.isAxiosError(failure) && (!failure.response || failure.response.status >= 500)) {
        setOffline(true);
        if (!readOnly) throw new AxiosError('تعذر تأكيد نتيجة العملية. تحقق من السجل عند عودة الاتصال قبل إعادة المحاولة.', 'ERR_NETWORK', config, null,
          { data: { error: 'تعذر تأكيد نتيجة العملية. تحقق من السجل عند عودة الاتصال قبل إعادة المحاولة.' }, status: 503, statusText: 'Offline', headers: {}, config });
        if (!healthCheck) return localResult();
      }
      throw failure;
    }
  };
}

// إضافة التوكن تلقائياً لكل الطلبات التي تتطلب مصادقة
api.interceptors.request.use(
  (config) => {
    if (config.baseURL?.replace(/\/+$/, '').endsWith('/api') && config.url?.startsWith('/api/')) {
      config.url = config.url.slice('/api'.length);
    }

    const token = localStorage.getItem('token');
    if (token) {
      config.headers.set('Authorization', 'Bearer ' + token);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || '';
    const isLoginRequest = requestUrl.split('?')[0].endsWith('/auth/login');
    if (error.response?.status === 401 && !isLoginRequest) {
      clearOfflineCache();
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.hash !== '#/login') {
        window.location.hash = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

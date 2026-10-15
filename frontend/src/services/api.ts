import axios from 'axios';

// Detect if running in Electron
// Check for file:// protocol (used by Electron packaged apps)
// or check for window.process (development Electron)
const isElectron = typeof window !== 'undefined' && 
                   (window.location.protocol === 'file:' || 
                    ((window as any).process && (window as any).process.type === 'renderer'));

// Force localhost for Electron - completely ignore environment variables
// In web development, use environment variable or fallback to localhost
const API_BASE_URL = isElectron 
  ? 'http://localhost:3001' 
  : (import.meta.env.VITE_API_URL || 'http://localhost:3001');

console.log('=== API Configuration ===');
console.log('window.location.protocol:', window.location.protocol);
console.log('window.process:', (window as any).process);
console.log('isElectron:', isElectron);
console.log('API Base URL:', API_BASE_URL);
console.log('==========================');

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    console.log('Adding auth token to request:', config.url);
  } else {
    console.warn('No auth token found in localStorage for request:', config.url);
  }
  return config;
});

// Handle response errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/api/auth/login');
    const isSetupRequest = error.config?.url?.includes('/api/auth/setup-admin');

    if (error.response?.status === 401 && !isLoginRequest && !isSetupRequest) {
      console.error('401 Unauthorized - clearing token and redirecting to login');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    } else if (error.response?.status === 403 && !isLoginRequest && !isSetupRequest) {
      console.error('403 Forbidden - token invalid, clearing and redirecting to login');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }

    // Log detailed error for debugging
    if (error.response) {
      console.error('API Error:', {
        status: error.response.status,
        data: error.response.data,
        url: error.config?.url,
      });
    } else if (error.request) {
      console.error('API Error: No response received', error.config?.url);
    } else {
      console.error('API Error:', error.message);
    }

    return Promise.reject(error);
  }
);

export default api;

import axios from 'axios';

// Use environment variable or fallback to localhost
// In development, this will proxy to backend
// In production (Electron), the backend runs locally
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

console.log('API Base URL:', API_BASE_URL);

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

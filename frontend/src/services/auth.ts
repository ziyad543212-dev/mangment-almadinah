import api from './api';
import type { AuthResponse, User } from '../types';
import { clearOfflineCache, endPreview, isOffline, isPreview } from './offline';

export const authService = {
  login: async (username: string, password: string): Promise<AuthResponse> => {
    const response = await api.post<AuthResponse>('/api/auth/login', { username, password });
    clearOfflineCache();
    endPreview();
    localStorage.setItem('token', response.data.token);
    authService.setUser(response.data.user);
    return response.data;
  },

  verifyToken: async (): Promise<User> => {
    const response = await api.get('/api/auth/verify');
    return response.data.user;
  },

  logout: () => {
    clearOfflineCache();
    endPreview();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  isAuthenticated: (): boolean => {
    return !!localStorage.getItem('token') || isPreview();
  },

  getUser: (): User | null => {
    const userStr = localStorage.getItem('user');
    try { return userStr ? JSON.parse(userStr) : null; }
    catch { return null; }
  },

  isAdmin: (): boolean => !isOffline() && !isPreview() && authService.getUser()?.role === 'admin',

  setUser: (user: User) => {
    localStorage.setItem('user', JSON.stringify(user));
  },
};

import { useSyncExternalStore } from 'react';

declare global {
  interface Window { __mangMobile?: { apiBaseUrl: string; offlineShell: boolean } }
}
export const mobileShell = !!window.__mangMobile?.offlineShell;
const PREVIEW_KEY = 'mang-offline-preview';
const CACHE_PREFIX = 'mang-read-cache-v1:';
let disconnected = mobileShell && (!navigator.onLine || sessionStorage.getItem(PREVIEW_KEY) === 'true');
const subscribers = new Set<() => void>();
export const isOffline = () => mobileShell && disconnected;
export const isPreview = () => mobileShell && sessionStorage.getItem(PREVIEW_KEY) === 'true';
export function setOffline(value: boolean) {
  if (!mobileShell || disconnected === value) return;
  disconnected = value;
  subscribers.forEach(listener => listener());
}
export function useOffline() { return useSyncExternalStore(listener => { subscribers.add(listener); return () => subscribers.delete(listener); }, isOffline); }
export function startPreview() { sessionStorage.setItem(PREVIEW_KEY, 'true'); setOffline(true); }
export function endPreview() { sessionStorage.removeItem(PREVIEW_KEY); }
export function clearOfflineCache() {
  Object.keys(localStorage).filter(key => key.startsWith(CACHE_PREFIX)).forEach(key => localStorage.removeItem(key));
}
function cacheKey(url: string) {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return user?.id && ['admin', 'employee'].includes(user.role) ? `${CACHE_PREFIX}${user.id}:${user.role}:${url}` : null;
  } catch { return null; }
}
const hiddenFields = new Set(['payments', 'cash_denominations', 'total_received', 'payment_count', 'payment_status', 'trip_cost_usd', 'net_trip', 'net_total', 'total_trip_cost', 'total_outstanding', 'operating_deficit', 'with_payments', 'without_payments', 'cash_total', 'sham_cash_total', 'totalReceived', 'totalTripCost', 'pilgrimsWithPayments', 'pilgrimsWithoutPayments']);
function operationalData(value: any): any {
  if (Array.isArray(value)) return value.map(operationalData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !hiddenFields.has(key)).map(([key, item]) => [key, operationalData(item)]));
}
export function isCacheable(url: string) {
  return /^\/(dashboard\/stats|trips(?:\/\d+(?:\/pilgrims|\/manifest)?)?|pilgrims\/\d+|reports\/(summary|nationalities|trips|by-trip))(?:\?|$)/.test(url);
}
export function rememberResponse(url: string, data: unknown) {
  const key = cacheKey(url);
  if (!key || !isCacheable(url)) return;
  try {
    const serialized = JSON.stringify({ savedAt: Date.now(), data: operationalData(data) });
    // Bound disk usage and evict oldest entries; a cache failure never fails a real request.
    if (serialized.length > 200_000) return;
    const keys = Object.keys(localStorage).filter(item => item.startsWith(CACHE_PREFIX));
    if (keys.length >= 50) {
      keys.sort((a, b) => JSON.parse(localStorage.getItem(a) || '{}').savedAt - JSON.parse(localStorage.getItem(b) || '{}').savedAt);
      localStorage.removeItem(keys[0]);
    }
    localStorage.setItem(key, serialized);
  } catch { /* Storage can be full or disabled. */ }
}
export function offlineResponse(url: string): unknown {
  const key = !isPreview() && cacheKey(url);
  if (key && isCacheable(url)) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && Date.now() - saved.savedAt < 24 * 60 * 60 * 1000) return operationalData(saved.data);
      localStorage.removeItem(key);
    } catch { localStorage.removeItem(key); }
  }
  const route = url.split('?')[0];
  if (route === '/trips') return { trips: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } };
  if (route === '/dashboard/stats') return {};
  if (route === '/reports/summary') return {};
  if (['/reports/trips', '/reports/nationalities', '/reports/by-trip'].includes(route)) return [];
  if (route === '/ocr/health') return { modes: { cloud: { status: 'offline', message: 'قراءة الجواز تحتاج اتصالًا بالخادم.' } }, engine_warning: 'يمكن فتح النموذج وإدخال الحقول؛ قراءة الجواز وحفظه يحتاجان اتصالًا بالخادم.' };
  return undefined;
}

// MICRO PAD Environment & Endpoint Configuration

export const BACKEND_URL = (
  (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_BACKEND_URL || import.meta.env?.VITE_SERVER_URL)) ||
  ''
).replace(/\/+$/, '');

export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (BACKEND_URL) {
    return `${BACKEND_URL}${cleanPath}`;
  }
  return cleanPath;
}

export function getSocketUrl(): string {
  if (BACKEND_URL) {
    return BACKEND_URL;
  }
  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }
  return 'http://localhost:3001';
}

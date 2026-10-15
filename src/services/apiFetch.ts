import { API_URL } from './apiBase';

export const apiFetch = async (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Sanitize path: strip leading /api if present to prevent double /api/api/...
  const cleanPath = path.replace(/^\/api(?=\/|$)/, '');
  const response = await fetch(`${API_URL}${cleanPath}`, { ...options, headers, credentials: 'include' });

  if (response.status === 401 && !cleanPath.startsWith('/auth/login')) {
    sessionStorage.removeItem('radar_authenticated');
    window.dispatchEvent(new CustomEvent('radar:unauthorized'));
  }

  return response;
};

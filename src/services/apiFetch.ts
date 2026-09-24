import { API_URL } from './apiBase';

export const apiFetch = async (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });

  if (response.status === 401 && !path.startsWith('/auth/login')) {
    sessionStorage.removeItem('radar_authenticated');
    window.dispatchEvent(new CustomEvent('radar:unauthorized'));
  }

  return response;
};

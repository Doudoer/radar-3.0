import { API_URL } from './apiBase';

export const apiFetch = (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  return fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
};

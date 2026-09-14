import { API_URL } from './apiBase';

export const apiFetch = (path: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('radar_token');
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  return fetch(`${API_URL}${path}`, { ...options, headers });
};

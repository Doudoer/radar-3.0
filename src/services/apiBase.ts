export const API_URL = import.meta.env.VITE_API_URL || '/api';
export const HEALTH_URL = `${API_URL.replace(/\/api\/?$/, '')}/health`;

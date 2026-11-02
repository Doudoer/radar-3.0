import { API_URL } from './apiBase';

let csrfToken = '';
let csrfRequest: Promise<string> | undefined;

const getCsrfToken = () => {
  if (csrfToken) return Promise.resolve(csrfToken);
  if (!csrfRequest) {
    csrfRequest = fetch(`${API_URL}/auth/csrf`, { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('No fue posible obtener la proteccion de seguridad. Recarga e intenta de nuevo.');
        const body: { token?: string } = await response.json();
        if (!body.token) throw new Error('Respuesta de seguridad invalida');
        csrfToken = body.token;
        return csrfToken;
      }).finally(() => { csrfRequest = undefined; });
  }
  return csrfRequest;
};

export const apiFetch = async (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Sanitize path: strip leading /api if present to prevent double /api/api/...
  const cleanPath = path.replace(/^\/api(?=\/|$)/, '');
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase());
  if (unsafe) headers.set('X-CSRF-Token', await getCsrfToken());
  const send = () => fetch(`${API_URL}${cleanPath}`, { ...options, headers, credentials: 'include' });
  let response = await send();
  if (unsafe && response.status === 403 && (await response.clone().json().catch(() => ({}))).code === 'CSRF_INVALID') {
    csrfToken = '';
    headers.set('X-CSRF-Token', await getCsrfToken());
    response = await send();
  }
  if (cleanPath.startsWith('/auth/') && unsafe && response.ok) csrfToken = '';

  if (response.status === 401 && !cleanPath.startsWith('/auth/login')) {
    sessionStorage.removeItem('radar_authenticated');
    window.dispatchEvent(new CustomEvent('radar:unauthorized'));
  }

  return response;
};

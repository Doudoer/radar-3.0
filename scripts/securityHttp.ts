export async function csrfHeaders(base: string, authorization = '', cookie = '', extraHeaders: Record<string, string> = {}) {
  const response = await fetch(`${base}/api/auth/csrf`, {
    headers: { ...extraHeaders, ...(authorization ? { Authorization: authorization } : {}), Cookie: cookie },
  });
  if (!response.ok) throw new Error(`No se pudo obtener CSRF: ${response.status}`);
  const body: { token: string } = await response.json();
  const csrfCookie = response.headers.getSetCookie().find(value => value.startsWith('radar_csrf='))?.split(';')[0];
  if (!body.token || !csrfCookie) throw new Error('Respuesta CSRF incompleta');
  return { 'X-CSRF-Token': body.token, Cookie: [cookie, csrfCookie].filter(Boolean).join('; ') };
}

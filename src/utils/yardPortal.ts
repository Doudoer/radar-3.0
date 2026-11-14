export const YARD_PORTAL_ROLES = ['admin', 'vendedor_yarda'] as const;

export const canAccessYardPortal = (role?: string | null): boolean => {
  const normalized = role?.trim().toLowerCase();
  return !!normalized && (YARD_PORTAL_ROLES as readonly string[]).includes(normalized);
};

export const stripYardPortalFromUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl, 'http://localhost');
    url.searchParams.delete('portal');
    const pathname = url.pathname.toLowerCase();
    if (pathname === '/yard' || pathname.startsWith('/yard/')) {
      url.pathname = '/';
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return rawUrl;
  }
};

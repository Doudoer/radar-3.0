export const isCallsPortalUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl, 'http://localhost');
    const pathname = url.pathname.toLowerCase();
    return (
      pathname === '/llamadas'
      || pathname.startsWith('/llamadas/')
      || pathname === '/calls-monitor'
      || url.searchParams.get('portal')?.toLowerCase() === 'calls'
    );
  } catch {
    return false;
  }
};

export const stripCallsPortalFromUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl, 'http://localhost');
    if (url.searchParams.get('portal')?.toLowerCase() === 'calls') {
      url.searchParams.delete('portal');
    }
    const pathname = url.pathname.toLowerCase();
    if (pathname === '/llamadas' || pathname.startsWith('/llamadas/') || pathname === '/calls-monitor') {
      url.pathname = '/';
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return rawUrl;
  }
};

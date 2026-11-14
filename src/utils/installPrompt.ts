export type MobilePlatform = 'ios' | 'android';

export interface MobileDevice {
  platform: MobilePlatform;
  deviceName: string;
  inAppBrowser: boolean;
}

export interface InstallPromptRecord {
  dismissedAt?: number;
  installedAt?: number;
}

export const INSTALL_PROMPT_STORAGE_PREFIX = 'radar:install-prompt:';
export const INSTALL_PROMPT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

const IN_APP_BROWSER_PATTERN = /(FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|Snapchat|Twitter|LinkedInApp|Pinterest)/i;

export const isInAppBrowser = (userAgent: string) => IN_APP_BROWSER_PATTERN.test(userAgent || '');

export const detectMobileDevice = (userAgent: string, maxTouchPoints = 0): MobileDevice | null => {
  const ua = userAgent || '';
  const inAppBrowser = isInAppBrowser(ua);
  // iPadOS 13+ se presenta como Macintosh; el touch lo delata.
  const iPadDesktopMode = /Macintosh/i.test(ua) && maxTouchPoints > 0;
  if (/iPhone/i.test(ua)) return { platform: 'ios', deviceName: 'iPhone', inAppBrowser };
  if (/iPad/i.test(ua)) return { platform: 'ios', deviceName: 'iPad', inAppBrowser };
  if (/iPod/i.test(ua)) return { platform: 'ios', deviceName: 'iPod touch', inAppBrowser };
  if (iPadDesktopMode) return { platform: 'ios', deviceName: 'iPad', inAppBrowser };
  if (/Android/i.test(ua)) {
    const tablet = /Tablet/i.test(ua) || !/Mobile/i.test(ua);
    return { platform: 'android', deviceName: tablet ? 'tablet Android' : 'Android', inAppBrowser };
  }
  return null;
};

export const isStandaloneDisplay = (
  matches: (query: string) => boolean,
  navigatorStandalone?: boolean,
) =>
  navigatorStandalone === true ||
  matches('(display-mode: standalone)') ||
  matches('(display-mode: fullscreen)') ||
  matches('(display-mode: minimal-ui)');

export const shouldOfferInstall = (
  device: MobileDevice | null,
  options: { standalone: boolean; record: InstallPromptRecord | null; now: number; cooldownMs?: number },
) => {
  if (!device) return false;
  if (options.standalone) return false;
  if (options.record?.installedAt) return false;
  const dismissedAt = options.record?.dismissedAt;
  if (dismissedAt && options.now - dismissedAt < (options.cooldownMs ?? INSTALL_PROMPT_COOLDOWN_MS)) return false;
  return true;
};

export const readInstallPromptRecord = (storage: Pick<Storage, 'getItem'> | null, key: string): InstallPromptRecord | null => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { dismissedAt, installedAt } = parsed as InstallPromptRecord;
    return {
      ...(typeof dismissedAt === 'number' ? { dismissedAt } : {}),
      ...(typeof installedAt === 'number' ? { installedAt } : {}),
    };
  } catch {
    return null;
  }
};

export const writeInstallPromptRecord = (
  storage: Pick<Storage, 'setItem'> | null,
  key: string,
  record: InstallPromptRecord,
) => {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(record));
  } catch {
    // Almacenamiento no disponible (modo privado): la alerta simplemente vuelve a mostrarse.
  }
};

export const isYardContext = (location: Pick<Location, 'hostname' | 'pathname' | 'search'>) => {
  const hostname = location.hostname.toLowerCase();
  return (
    hostname.startsWith('yard.') ||
    hostname.includes('yard.localhost') ||
    location.pathname.toLowerCase().startsWith('/yard') ||
    location.search.includes('portal=yard')
  );
};

export const manifestHrefForContext = (yard: boolean) => (yard ? '/manifest.json' : '/manifest-office.json');

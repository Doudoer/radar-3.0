import { describe, expect, it } from 'vitest';
import {
  INSTALL_PROMPT_COOLDOWN_MS,
  detectMobileDevice,
  isInAppBrowser,
  isStandaloneDisplay,
  isYardContext,
  manifestHrefForContext,
  readInstallPromptRecord,
  shouldOfferInstall,
  writeInstallPromptRecord,
} from '../src/utils/installPrompt';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const ANDROID_TABLET_UA = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const INSTAGRAM_UA = `${IPHONE_UA} Instagram 320.0.0.0`;

const now = new Date('2026-11-14T12:00:00Z').getTime();

describe('mobile device detection', () => {
  it('detects iPhone as iOS', () => {
    expect(detectMobileDevice(IPHONE_UA, 5)).toEqual({ platform: 'ios', deviceName: 'iPhone', inAppBrowser: false });
  });

  it('detects iPad and iPadOS desktop mode as iOS tablets', () => {
    expect(detectMobileDevice(IPAD_UA, 5)).toMatchObject({ platform: 'ios', deviceName: 'iPad' });
    expect(detectMobileDevice(IPAD_DESKTOP_UA, 5)).toMatchObject({ platform: 'ios', deviceName: 'iPad' });
    expect(detectMobileDevice(IPAD_DESKTOP_UA, 1)).toMatchObject({ platform: 'ios', deviceName: 'iPad' });
  });

  it('leaves desktop browsers alone', () => {
    expect(detectMobileDevice(MAC_UA, 0)).toBeNull();
    expect(detectMobileDevice(IPAD_DESKTOP_UA, 0)).toBeNull();
  });

  it('detects Android phones and tablets', () => {
    expect(detectMobileDevice(ANDROID_UA, 5)).toMatchObject({ platform: 'android', deviceName: 'Android' });
    expect(detectMobileDevice(ANDROID_TABLET_UA, 5)).toMatchObject({ platform: 'android', deviceName: 'tablet Android' });
  });

  it('flags in-app browsers', () => {
    expect(isInAppBrowser(INSTAGRAM_UA)).toBe(true);
    expect(isInAppBrowser(`${IPHONE_UA} [FBAN/FBIOS;FBAV/460.0]`)).toBe(true);
    expect(isInAppBrowser(IPHONE_UA)).toBe(false);
    expect(detectMobileDevice(INSTAGRAM_UA, 5)?.inAppBrowser).toBe(true);
  });
});

describe('install prompt eligibility', () => {
  const device = detectMobileDevice(IPHONE_UA, 5);

  it('offers the prompt on a phone browsing normally', () => {
    expect(shouldOfferInstall(device, { standalone: false, record: null, now })).toBe(true);
  });

  it('never offers it on desktop, installed or recently dismissed devices', () => {
    expect(shouldOfferInstall(null, { standalone: false, record: null, now })).toBe(false);
    expect(shouldOfferInstall(device, { standalone: true, record: null, now })).toBe(false);
    expect(shouldOfferInstall(device, { standalone: false, record: { installedAt: now - 1000 }, now })).toBe(false);
    expect(shouldOfferInstall(device, { standalone: false, record: { dismissedAt: now - 24 * 60 * 60 * 1000 }, now })).toBe(false);
  });

  it('offers it again after the cooldown expires', () => {
    expect(shouldOfferInstall(device, {
      standalone: false,
      record: { dismissedAt: now - INSTALL_PROMPT_COOLDOWN_MS - 1000 },
      now,
    })).toBe(true);
  });
});

describe('standalone detection', () => {
  it('recognizes iOS navigator.standalone and display-mode media queries', () => {
    expect(isStandaloneDisplay(() => false, true)).toBe(true);
    expect(isStandaloneDisplay((query) => query === '(display-mode: standalone)', false)).toBe(true);
    expect(isStandaloneDisplay((query) => query === '(display-mode: minimal-ui)', false)).toBe(true);
    expect(isStandaloneDisplay(() => false, false)).toBe(false);
  });
});

describe('prompt record persistence', () => {
  const createStorage = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    return {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => { data[key] = value; },
    };
  };

  it('round-trips timestamps and ignores malformed payloads', () => {
    const storage = createStorage();
    writeInstallPromptRecord(storage, 'k', { dismissedAt: 123 });
    expect(readInstallPromptRecord(storage, 'k')).toEqual({ dismissedAt: 123 });
    expect(readInstallPromptRecord(createStorage({ k: 'not-json' }), 'k')).toBeNull();
    expect(readInstallPromptRecord(createStorage({ k: '42' }), 'k')).toBeNull();
    expect(readInstallPromptRecord(null, 'k')).toBeNull();
  });

  it('drops values that are not numbers', () => {
    const storage = createStorage({ k: JSON.stringify({ dismissedAt: 'ayer', installedAt: 10 }) });
    expect(readInstallPromptRecord(storage, 'k')).toEqual({ installedAt: 10 });
  });
});

describe('area context', () => {
  it('recognizes yard host, path and query', () => {
    expect(isYardContext({ hostname: 'yard.radar-rsy.store', pathname: '/', search: '' })).toBe(true);
    expect(isYardContext({ hostname: 'radar.localhost', pathname: '/yard', search: '' })).toBe(true);
    expect(isYardContext({ hostname: 'radar.localhost', pathname: '/', search: '?portal=yard' })).toBe(true);
    expect(isYardContext({ hostname: 'radar-rsy.store', pathname: '/', search: '' })).toBe(false);
  });

  it('maps each area to its own manifest', () => {
    expect(manifestHrefForContext(true)).toBe('/manifest.json');
    expect(manifestHrefForContext(false)).toBe('/manifest-office.json');
  });
});

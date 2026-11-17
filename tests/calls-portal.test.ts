import { describe, expect, it } from 'vitest';
import { isCallsPortalUrl, stripCallsPortalFromUrl } from '../src/utils/callsPortal';

describe('calls portal routing', () => {
  it('detects and strips dedicated calls portal URLs', () => {
    expect(isCallsPortalUrl('https://calls.radar-rsy.store/')).toBe(true);
    expect(isCallsPortalUrl('http://calls.localhost:3000/')).toBe(true);
    expect(isCallsPortalUrl('https://radar-rsy.store/llamadas')).toBe(true);
    expect(isCallsPortalUrl('http://127.0.0.1:3000/calls-monitor')).toBe(true);
    expect(isCallsPortalUrl('http://127.0.0.1:3000/?portal=calls')).toBe(true);
    expect(isCallsPortalUrl('http://127.0.0.1:3000/')).toBe(false);

    expect(stripCallsPortalFromUrl('https://radar-rsy.store/llamadas')).toBe('/');
    expect(stripCallsPortalFromUrl('http://127.0.0.1:3000/?portal=calls&foo=1')).toBe('/?foo=1');
  });
});

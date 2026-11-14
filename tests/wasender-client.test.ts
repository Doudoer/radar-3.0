import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WasenderClient } from '../src/integrations/wasender/client';

const okResponse = () =>
  new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const localClient = () =>
  new WasenderClient({
    baseUrl: 'https://wasender.mock',
    apiKey: 'test-key',
    sendTextPath: '/send',
    testPhone: '04121234567',
    forceTestRecipient: true,
    enabled: true,
  });

const lastBody = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));

describe('Wasender local test-recipient redirect', () => {
  beforeEach(() => {
    (WasenderClient as unknown as { lastSendTimestamp: number }).lastSendTimestamp = 0;
    (WasenderClient as unknown as { queuePromise: Promise<unknown> }).queuePromise = Promise.resolve();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects any recipient to the internal test phone and annotates the text', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const res = await localClient().sendText({ to: '+13055551234', text: 'Hola' });
    const body = lastBody(fetchMock);

    expect(body.to).toBe('+584121234567');
    expect(body.text).toContain('Hola');
    expect(body.text).toContain('Modo Pruebas Radar V3');
    expect(body.text).toContain('+13055551234');
    expect(res.recipientUsed).toBe('+584121234567');
    expect(res.originalRecipient).toBe('+13055551234');
    expect(res.isTestRedirect).toBe(true);
  });

  it('does not redirect nor annotate when the target is already the test phone', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const res = await localClient().sendText({ to: '04121234567', text: 'Hola' });
    const body = lastBody(fetchMock);

    expect(body.to).toBe('+584121234567');
    expect(body.text).toBe('Hola');
    expect(res.isTestRedirect).toBe(false);
  });

  it('redirects image and document sends with the notice in the caption', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await localClient().sendImage({ to: '+13055551234', url: 'https://img.test/a.png', caption: 'Foto' });
    let body = lastBody(fetchMock);
    expect(body.to).toBe('+584121234567');
    expect(body.imageUrl).toBe('https://img.test/a.png');
    expect(body.text).toContain('Modo Pruebas Radar V3');

    (WasenderClient as unknown as { lastSendTimestamp: number }).lastSendTimestamp = 0;
    await localClient().sendFile({
      to: '+13055551234',
      url: 'https://files.test/a.pdf',
      filename: 'a.pdf',
      caption: 'Doc',
    });
    body = lastBody(fetchMock);
    expect(body.to).toBe('+584121234567');
    expect(body.documentUrl).toBe('https://files.test/a.pdf');
    expect(body.fileName).toBe('a.pdf');
    expect(body.text).toContain('Modo Pruebas Radar V3');
  });

  it('stays disabled and refuses to send when WASENDER_ENABLED=false', async () => {
    const previous = process.env.WASENDER_ENABLED;
    process.env.WASENDER_ENABLED = 'false';
    try {
      const client = new WasenderClient({ baseUrl: 'https://wasender.mock', apiKey: 'test-key' });
      expect(client.configured).toBe(false);
      await expect(client.sendText({ to: '+13055551234', text: 'Hola' })).rejects.toThrow('deshabilitado');
    } finally {
      if (previous === undefined) delete process.env.WASENDER_ENABLED;
      else process.env.WASENDER_ENABLED = previous;
    }
  });

  it('requires an explicit WASENDER_ENABLED=true even when a key is present', async () => {
    const previous = process.env.WASENDER_ENABLED;
    delete process.env.WASENDER_ENABLED;
    try {
      const client = new WasenderClient({ baseUrl: 'https://wasender.mock', apiKey: 'test-key' });
      expect(client.configured).toBe(false);
      await expect(client.sendText({ to: '+13055551234', text: 'Hola' })).rejects.toThrow('deshabilitado');
    } finally {
      if (previous === undefined) delete process.env.WASENDER_ENABLED;
      else process.env.WASENDER_ENABLED = previous;
    }
  });
});

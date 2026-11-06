import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadDownpaymentReceipt } from '../src/components/DownpaymentConfirmation';
import { uploadAftersalesFile } from '../src/components/OrderAftersales';
import { apiFetch } from '../src/services/apiFetch';

vi.mock('../src/services/apiFetch', () => ({ apiFetch: vi.fn() }));
let readFailure: 'error' | 'invalid' | null = null;
beforeEach(() => {
  readFailure = null;
  vi.mocked(apiFetch).mockReset();
  vi.stubGlobal('FileReader', class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(file: File) {
      if (readFailure === 'error') { this.onerror?.(); return; }
      this.result = readFailure === 'invalid' ? null : `data:${file.type};base64,dGVzdA==`;
      this.onload?.();
    }
  });
});
afterEach(() => vi.unstubAllGlobals());
const image = () => new File(['test'], 'conversation.png', { type: 'image/png' });

describe('shared order file upload', () => {
  it('rejects malformed, remote and wrong-type upload responses instead of accepting unusable evidence', async () => {
    for (const upload of [uploadDownpaymentReceipt, uploadAftersalesFile]) {
      for (const url of [undefined, 12, 'https://example.test/file.png', '/uploads/../file.png', '/uploads/file.pdf', '/uploads/file.svg']) {
        vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ url })));
        await expect(upload('901', image())).rejects.toThrow(/inválida/);
      }
    }
  });
  it('uploads valid images from each flow and PDFs only from aftersales with the order identifier', async () => {
    for (const [upload, file, url] of [
      [uploadDownpaymentReceipt, image(), '/uploads/conversation.png'],
      [uploadAftersalesFile, image(), '/uploads/piece.png'],
      [uploadAftersalesFile, new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' }), '/uploads/invoice.pdf'],
    ] as const) {
      vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ url }), { status: 201 }));
      expect(await upload('901', file)).toBe(url);
      const options = vi.mocked(apiFetch).mock.calls.at(-1)![1];
      expect(JSON.parse(String(options?.body))).toMatchObject({ orderId: 901, filename: file.name, contentType: file.type });
    }
  });
  it('rejects empty, unsupported and oversized input without attempting an upload', async () => {
    for (const upload of [uploadDownpaymentReceipt, uploadAftersalesFile]) {
      for (const file of [new File([], 'empty.png', { type: 'image/png' }),
        new File(['svg'], 'file.svg', { type: 'image/svg+xml' }),
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })]) {
        await expect(upload('901', file)).rejects.toThrow();
      }
    }
    await expect(uploadDownpaymentReceipt('901', new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' }))).rejects.toThrow();
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it('accepts the exact 10 MB image limit', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ url: '/uploads/exact.png' })));
    await expect(uploadDownpaymentReceipt('901', new File([new Uint8Array(10 * 1024 * 1024)], 'exact.png', { type: 'image/png' })))
      .resolves.toBe('/uploads/exact.png');
  });
  it('surfaces reader, HTTP and network failures without returning a file URL', async () => {
    for (const upload of [uploadDownpaymentReceipt, uploadAftersalesFile]) {
      for (const failure of ['error', 'invalid'] as const) {
        readFailure = failure;
        await expect(upload('901', image())).rejects.toThrow(/leer/);
      }
      readFailure = null;
      vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Upload denied' }), { status: 403 }));
      await expect(upload('901', image())).rejects.toThrow('Upload denied');
      vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Network unavailable'));
      await expect(upload('901', image())).rejects.toThrow('Network unavailable');
    }
  });
});

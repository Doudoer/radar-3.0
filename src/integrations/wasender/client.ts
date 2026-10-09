import { WasenderClientOptions, WasenderMediaMessage, WasenderResponse, WasenderTextMessage } from './types';

const trimSlash = (value: string) => value.replace(/\/+$/, '');

export class WasenderError extends Error {
  constructor(message: string, public readonly code: 'CONFIGURATION' | 'TIMEOUT' | 'NETWORK' | 'HTTP') {
    super(message);
    this.name = 'WasenderError';
  }
}

/**
 * Normalizes phone number to E.164 standard with '+' prefix for Wasender API.
 * Handles Venezuelan formats (0412xxxxxxx -> +58412xxxxxxx, 412xxxxxxx -> +58412xxxxxxx).
 */
export function formatWasenderPhone(phone: string): string {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }
  // If user entered Venezuelan local format like 04121234567 -> 584121234567
  if (cleaned.startsWith('04') && cleaned.length === 11) {
    cleaned = '58' + cleaned.substring(1);
  } else if (
    cleaned.length === 10 &&
    (cleaned.startsWith('412') || cleaned.startsWith('414') || cleaned.startsWith('424') || cleaned.startsWith('416') || cleaned.startsWith('426'))
  ) {
    cleaned = '58' + cleaned;
  }
  return '+' + cleaned;
}

const DEFAULT_WASENDER_API_KEY = '0c4608ba493e8a32348c0dd71da85489855ed6ca74f648694f46947db0b4041c';
const DEFAULT_WASENDER_BASE_URL = 'https://wasenderapi.com';

export class WasenderClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly deviceId?: string;
  private readonly sendTextPath: string;
  private readonly testPhone: string;
  private readonly forceTestRecipient: boolean;

  constructor(options: WasenderClientOptions = {}) {
    this.baseUrl = trimSlash(options.baseUrl || process.env.WASENDER_BASE_URL || DEFAULT_WASENDER_BASE_URL);
    this.apiKey = (options.apiKey || process.env.WASENDER_API_KEY || DEFAULT_WASENDER_API_KEY).trim();
    this.deviceId = options.deviceId || process.env.WASENDER_DEVICE_ID;
    this.sendTextPath = options.sendTextPath || process.env.WASENDER_SEND_TEXT_PATH || '/api/send-message';
    this.testPhone = options.testPhone || process.env.WASENDER_TEST_PHONE || '584127307933';
    this.forceTestRecipient =
      options.forceTestRecipient !== undefined
        ? options.forceTestRecipient
        : process.env.WASENDER_FORCE_TEST_RECIPIENT === 'true';
  }

  get configured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  get isTestMode(): boolean {
    return this.forceTestRecipient && Boolean(this.testPhone);
  }

  get designatedTestPhone(): string {
    return this.testPhone ? formatWasenderPhone(this.testPhone) : '';
  }

  private resolveRecipient(rawTarget: string): { finalTo: string; isRedirected: boolean; originalTo: string } {
    const formattedTarget = formatWasenderPhone(rawTarget);
    if (this.isTestMode && this.testPhone) {
      const formattedTestPhone = formatWasenderPhone(this.testPhone);
      if (formattedTarget !== formattedTestPhone) {
        return {
          finalTo: formattedTestPhone,
          isRedirected: true,
          originalTo: formattedTarget,
        };
      }
    }
    return {
      finalTo: formattedTarget,
      isRedirected: false,
      originalTo: formattedTarget,
    };
  }

  private static lastSendTimestamp = 0;
  private static queuePromise: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const execute = async () => {
      const minGapMs = 5300;
      const now = Date.now();
      const elapsed = now - WasenderClient.lastSendTimestamp;
      if (elapsed < minGapMs && WasenderClient.lastSendTimestamp > 0) {
        const waitTime = minGapMs - elapsed;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
      try {
        const res = await fn();
        WasenderClient.lastSendTimestamp = Date.now();
        return res;
      } catch (err) {
        WasenderClient.lastSendTimestamp = Date.now();
        throw err;
      }
    };

    const next = WasenderClient.queuePromise.then(execute, execute);
    WasenderClient.queuePromise = next.catch(() => {});
    return next;
  }

  private async request<T>(path: string, body: Record<string, unknown>, retryCount = 0): Promise<WasenderResponse<T>> {
    if (!this.configured) throw new WasenderError('Wasender no está configurado (falta API Key o Base URL)', 'CONFIGURATION');

    const targetUrl = `${this.baseUrl}${path}`;
    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ ...body, ...(this.deviceId ? { deviceId: this.deviceId } : {}) }),
        signal: AbortSignal.timeout(20_000),
      });

      const raw = await response.text();
      let data: T;
      try {
        data = raw ? (JSON.parse(raw) as T) : ({} as T);
      } catch {
        data = { raw } as unknown as T;
      }

      if (!response.ok) {
        const errorDetail = typeof data === 'object' && data && 'message' in data ? String((data as { message: unknown }).message) : `HTTP ${response.status}`;
        if ((errorDetail.toLowerCase().includes('account protection') || response.status === 429) && retryCount < 2) {
          console.warn(`[Wasender Queue] ⏳ Límite de cuenta detectado. Reintentando transmisión en 5.5s (intento ${retryCount + 1}/2)...`);
          await new Promise((resolve) => setTimeout(resolve, 5500));
          WasenderClient.lastSendTimestamp = Date.now();
          return this.request<T>(path, body, retryCount + 1);
        }
        throw new WasenderError(`Wasender respondió error: ${errorDetail}`, 'HTTP');
      }

      return {
        status: response.status,
        data,
      };
    } catch (error) {
      if (error instanceof WasenderError) throw error;
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new WasenderError('Tiempo de espera agotado al contactar Wasender (20s)', 'TIMEOUT');
      }
      throw new WasenderError(error instanceof Error ? error.message : 'No se pudo contactar con Wasender', 'NETWORK');
    }
  }

  async sendText(message: WasenderTextMessage): Promise<WasenderResponse<{ success?: boolean; data?: { msgId?: number; jid?: string; status?: string } }>> {
    return this.enqueue(async () => {
      const { finalTo, isRedirected, originalTo } = this.resolveRecipient(message.to);
      let text = message.text;
      if (isRedirected) {
        text += `\n\n_🧪 [Modo Pruebas Radar V3 • Destinatario original: ${originalTo}]_`;
      }

      const res = await this.request<{ success?: boolean; data?: { msgId?: number; jid?: string; status?: string } }>(this.sendTextPath, {
        to: finalTo,
        text,
      });

      res.recipientUsed = finalTo;
      res.originalRecipient = originalTo;
      res.isTestRedirect = isRedirected;
      return res;
    });
  }

  async sendImage(message: WasenderMediaMessage): Promise<WasenderResponse<{ success?: boolean; data?: { msgId?: number; jid?: string; status?: string } }>> {
    return this.enqueue(async () => {
      const { finalTo, isRedirected, originalTo } = this.resolveRecipient(message.to);
      let caption = message.caption || '';
      if (isRedirected) {
        caption += `\n\n_🧪 [Modo Pruebas Radar V3 • Destinatario original: ${originalTo}]_`;
      }

      const res = await this.request<{ success?: boolean; data?: { msgId?: number; jid?: string; status?: string } }>(this.sendTextPath, {
        to: finalTo,
        text: caption,
        imageUrl: message.url,
      });

      res.recipientUsed = finalTo;
      res.originalRecipient = originalTo;
      res.isTestRedirect = isRedirected;
      return res;
    });
  }

  async sendFile(message: WasenderMediaMessage): Promise<WasenderResponse<{ success?: boolean; data?: { msgId?: number; jid?: string; status?: string } }>> {
    return this.enqueue(async () => {
      const { finalTo, isRedirected, originalTo } = this.resolveRecipient(message.to);
      let caption = message.caption || '';
      if (isRedirected) {
        caption += `\n\n_🧪 [Modo Pruebas Radar V3 • Destinatario original: ${originalTo}]_`;
      }

      const res = await this.request<{ success?: boolean; data?: { msgId?: number; jid?: string; status?: string } }>(this.sendTextPath, {
        to: finalTo,
        text: caption,
        documentUrl: message.url,
        fileName: message.filename || 'documento.pdf',
      });

      res.recipientUsed = finalTo;
      res.originalRecipient = originalTo;
      res.isTestRedirect = isRedirected;
      return res;
    });
  }
}

export const wasender = new WasenderClient();

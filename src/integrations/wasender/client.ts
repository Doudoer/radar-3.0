import { WasenderClientOptions, WasenderMediaMessage, WasenderResponse, WasenderTextMessage } from './types';

const trimSlash = (value: string) => value.replace(/\/+$/, '');

export class WasenderError extends Error {
  constructor(message: string, public readonly code: 'CONFIGURATION' | 'TIMEOUT' | 'NETWORK' | 'HTTP') {
    super(message);
    this.name = 'WasenderError';
  }
}

export class WasenderClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly deviceId?: string;
  private readonly paths: Required<Pick<WasenderClientOptions, 'sendTextPath' | 'sendImagePath' | 'sendFilePath'>>;

  constructor(options: WasenderClientOptions = {}) {
    this.baseUrl = trimSlash(options.baseUrl || process.env.WASENDER_BASE_URL || '');
    this.apiKey = options.apiKey || process.env.WASENDER_API_KEY || '';
    this.deviceId = options.deviceId || process.env.WASENDER_DEVICE_ID;
    this.paths = {
      sendTextPath: options.sendTextPath || process.env.WASENDER_SEND_TEXT_PATH || '/api/send-message',
      sendImagePath: options.sendImagePath || process.env.WASENDER_SEND_IMAGE_PATH || '/api/send-image',
      sendFilePath: options.sendFilePath || process.env.WASENDER_SEND_FILE_PATH || '/api/send-file',
    };
  }

  get configured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<WasenderResponse<T>> {
    if (!this.configured) throw new WasenderError('Wasender no está configurado', 'CONFIGURATION');
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ ...body, ...(this.deviceId ? { deviceId: this.deviceId } : {}) }),
        signal: AbortSignal.timeout(15_000),
      });
      const raw = await response.text();
      let data: T;
      try {
        data = raw ? JSON.parse(raw) as T : ({} as T);
      } catch {
        data = { raw } as T;
      }
      if (!response.ok) throw new WasenderError(`Wasender respondió HTTP ${response.status}`, 'HTTP');
      return { status: response.status, data };
    } catch (error) {
      if (error instanceof WasenderError) throw error;
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new WasenderError('Tiempo de espera agotado al contactar Wasender', 'TIMEOUT');
      }
      throw new WasenderError('No se pudo contactar Wasender', 'NETWORK');
    }
  }

  sendText(message: WasenderTextMessage) {
    return this.request(this.paths.sendTextPath, { phone: message.to, message: message.text });
  }

  sendImage(message: WasenderMediaMessage) {
    return this.request(this.paths.sendImagePath, { phone: message.to, image: message.url, caption: message.caption });
  }

  sendFile(message: WasenderMediaMessage) {
    return this.request(this.paths.sendFilePath, { phone: message.to, document: message.url, caption: message.caption, filename: message.filename });
  }
}

export const wasender = new WasenderClient();

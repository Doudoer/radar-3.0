export interface WasenderTextMessage {
  to: string;
  text: string;
}

export interface WasenderMediaMessage {
  to: string;
  url: string;
  caption?: string;
  filename?: string;
}

export interface WasenderClientOptions {
  baseUrl?: string;
  apiKey?: string;
  deviceId?: string;
  sendTextPath?: string;
  sendImagePath?: string;
  sendFilePath?: string;
}

export interface WasenderResponse<T = unknown> {
  status: number;
  data: T;
}

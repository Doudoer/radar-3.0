export type UploadKind = 'file' | 'image';

export interface UploadInput {
  buffer: Uint8Array;
  originalName: string;
  mimeType: string;
  kind?: UploadKind;
}

export interface StoredFile {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  kind: UploadKind;
  relativePath: string;
  absolutePath: string;
}

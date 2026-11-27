import type { BookFormat, BookMetadata, PageDescriptor } from '@shared/types';

export interface PagePayload {
  data: Buffer;
  mimeType: string;
}

export interface OpenedAdapterResult {
  metadata: BookMetadata;
  pages: PageDescriptor[];
  pdfFilePath?: string;
}

export interface BookAdapter {
  readonly format: BookFormat;
  open(): Promise<OpenedAdapterResult>;
  getPagePayload(pageIndex: number): Promise<PagePayload>;
  getAsset?(relativePath: string): Promise<PagePayload | null>;
  getCoverImage(): Promise<PagePayload | null>;
  close(): Promise<void>;
}

/**
 * Simple byte- and entry-bounded LRU cache for extracted archive pages.
 */
export class LruPageCache {
  private readonly map = new Map<string, PagePayload>();
  private currentBytes = 0;

  constructor(
    private readonly maxEntries = 18,
    private readonly maxBytes = 64 * 1024 * 1024,
  ) {}

  get(key: string): PagePayload | undefined {
    const existing = this.map.get(key);
    if (!existing) return undefined;
    // Refresh recency
    this.map.delete(key);
    this.map.set(key, existing);
    return existing;
  }

  set(key: string, payload: PagePayload): void {
    const existing = this.map.get(key);
    if (existing) {
      this.currentBytes -= existing.data.byteLength;
      this.map.delete(key);
    }

    const size = payload.data.byteLength;
    if (size > this.maxBytes) {
      return;
    }

    this.map.set(key, payload);
    this.currentBytes += size;

    while (this.map.size > this.maxEntries || this.currentBytes > this.maxBytes) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.map.get(oldestKey);
      if (oldest) {
        this.currentBytes -= oldest.data.byteLength;
      }
      this.map.delete(oldestKey);
    }
  }

  clear(): void {
    this.map.clear();
    this.currentBytes = 0;
  }
}

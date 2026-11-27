import fs from 'node:fs/promises';
import path from 'node:path';
import type { BookFormat, OpenedBookSession } from '@shared/types';
import { computeBookId, type AppPersistence } from '@main/storage/persistence';
import { optimizeCoverThumbnail } from '@main/library/thumbnailer';
import { detectBookFormat } from './detectFormat';
import { CbzAdapter } from './cbzAdapter';
import { CbrAdapter } from './cbrAdapter';
import { EpubAdapter } from './epubAdapter';
import { PdfAdapter } from './pdfAdapter';
import type { BookAdapter, PagePayload } from './types';

export function createBookAdapter(filePath: string, format: BookFormat): BookAdapter {
  switch (format) {
    case 'cbz':
      return new CbzAdapter(filePath);
    case 'cbr':
      return new CbrAdapter(filePath);
    case 'epub':
      return new EpubAdapter(filePath);
    case 'pdf':
      return new PdfAdapter(filePath);
  }
}

interface ActiveSessionEntry {
  bookId: string;
  filePath: string;
  adapter: BookAdapter;
}

export class BookSessionManager {
  private readonly sessions = new Map<string, ActiveSessionEntry>();

  constructor(private readonly persistence: AppPersistence) {}

  async openBook(filePath: string): Promise<OpenedBookSession> {
    const resolved = path.resolve(filePath);
    const stat = await fs.stat(resolved);
    const format = await detectBookFormat(resolved);
    const bookId = computeBookId(resolved);

    // Close existing session for this bookId if already open
    await this.closeBook(bookId);

    // Keep memory lean by closing other open sessions (single active reader window)
    for (const existingId of Array.from(this.sessions.keys())) {
      if (existingId !== bookId) {
        await this.closeBook(existingId);
      }
    }

    const adapter = createBookAdapter(resolved, format);
    const opened = await adapter.open();

    this.sessions.set(bookId, {
      bookId,
      filePath: resolved,
      adapter,
    });

    const existingBook = this.persistence.getBook(bookId);
    const folderPath = existingBook?.folderPath ?? '';
    const bookRecord = this.persistence.ensureBookForFile({
      filePath: resolved,
      folderPath,
      format,
      fileSize: stat.size,
      modifiedAt: stat.mtimeMs,
      metadata: opened.metadata,
      pageCount: opened.pages.length > 0 ? opened.pages.length : null,
    });
    this.persistence.markBookOpened(
      bookId,
      opened.metadata,
      opened.pages.length > 0 ? opened.pages.length : null,
    );

    // Cache cover thumbnail right away if not ready yet (for CBZ/CBR/EPUB opened directly)
    if (!bookRecord.thumbnailReady && format !== 'pdf') {
      void adapter
        .getCoverImage()
        .then(async (cover) => {
          if (cover && cover.data.byteLength > 0) {
            const optimized = optimizeCoverThumbnail(cover.data);
            await fs.writeFile(this.persistence.getThumbnailPath(bookId), optimized);
            this.persistence.markThumbnailReady(bookId, opened.pages.length || null);
          }
        })
        .catch(() => {});
    }

    return {
      bookId,
      filePath: resolved,
      format,
      metadata: opened.metadata,
      pageCount: opened.pages.length,
      pages: opened.pages,
      pdfUrl: format === 'pdf' ? `manga-page://file/${encodeURIComponent(bookId)}` : undefined,
      initialProgress: bookRecord.progress,
      bookmarks: [...bookRecord.bookmarks],
    };
  }

  getFilePath(bookId: string): string | null {
    return this.sessions.get(bookId)?.filePath ?? null;
  }

  async getPagePayload(bookId: string, pageIndex: number): Promise<PagePayload> {
    const entry = this.sessions.get(bookId);
    if (!entry) {
      throw new Error(`No open session for bookId: ${bookId}`);
    }
    return entry.adapter.getPagePayload(pageIndex);
  }

  async getAsset(bookId: string, relativePath: string): Promise<PagePayload | null> {
    const entry = this.sessions.get(bookId);
    if (!entry || !entry.adapter.getAsset) {
      return null;
    }
    return entry.adapter.getAsset(relativePath);
  }

  async closeBook(bookId: string): Promise<void> {
    const entry = this.sessions.get(bookId);
    if (!entry) return;
    this.sessions.delete(bookId);
    await entry.adapter.close();
  }

  async closeAll(): Promise<void> {
    const entries = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.allSettled(entries.map((e) => e.adapter.close()));
  }
}

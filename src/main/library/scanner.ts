import fs from 'node:fs/promises';
import path from 'node:path';
import type { BookFormat, LibraryBook, LibrarySnapshot } from '@shared/types';
import { detectBookFormat, isSupportedBookExtension } from '@main/formats/detectFormat';
import type { BookAdapter } from '@main/formats/types';
import type { AppPersistence } from '@main/storage/persistence';
import { optimizeCoverThumbnail } from './thumbnailer';

export type AdapterFactory = (filePath: string, format: BookFormat) => BookAdapter;

export class LibraryScanner {
  private scanning = false;
  private thumbQueue: LibraryBook[] = [];
  private activeThumbWorkers = 0;
  private readonly queuedIds = new Set<string>();
  private readonly maxThumbConcurrency = 3;

  constructor(
    private readonly persistence: AppPersistence,
    private readonly createAdapter: AdapterFactory,
    private readonly onLibraryUpdated: (snapshot: LibrarySnapshot) => void,
  ) {}

  isScanning(): boolean {
    return this.scanning;
  }

  private emitUpdate(): void {
    this.onLibraryUpdated(this.persistence.getLibrarySnapshot(this.scanning));
  }

  async scanAllFolders(): Promise<LibrarySnapshot> {
    if (this.scanning) {
      return this.persistence.getLibrarySnapshot(true);
    }
    this.scanning = true;
    this.emitUpdate();

    try {
      for (const folder of this.persistence.getFolders()) {
        await this.scanSingleFolderInternal(folder);
      }
    } finally {
      this.scanning = false;
      this.emitUpdate();
    }

    return this.persistence.getLibrarySnapshot(false);
  }

  async scanFolder(folderPath: string): Promise<LibrarySnapshot> {
    this.scanning = true;
    this.emitUpdate();
    try {
      await this.scanSingleFolderInternal(folderPath);
    } finally {
      this.scanning = false;
      this.emitUpdate();
    }
    return this.persistence.getLibrarySnapshot(false);
  }

  private async scanSingleFolderInternal(rootFolder: string): Promise<void> {
    const discoveredIds = new Set<string>();
    const pendingThumbs: LibraryBook[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        if (!entry.isFile() || !isSupportedBookExtension(fullPath)) {
          continue;
        }

        try {
          const stat = await fs.stat(fullPath);
          const format = await detectBookFormat(fullPath);
          const book = this.persistence.ensureBookForFile({
            filePath: fullPath,
            folderPath: rootFolder,
            format,
            fileSize: stat.size,
            modifiedAt: stat.mtimeMs,
          });
          discoveredIds.add(book.id);

          if (!book.thumbnailReady && book.format !== 'pdf') {
            pendingThumbs.push(book);
          } else if (book.thumbnailReady) {
            // Verify cached thumbnail file still exists
            try {
              await fs.access(this.persistence.getThumbnailPath(book.id));
            } catch {
              if (book.format !== 'pdf') {
                pendingThumbs.push(book);
              }
            }
          }
        } catch (err) {
          console.warn(`[scanner] Skipping unreadable file ${fullPath}:`, err);
        }
      }
    };

    await walk(rootFolder);
    this.persistence.pruneMissingFolderBooks(rootFolder, discoveredIds);

    if (pendingThumbs.length > 0) {
      this.enqueueThumbnails(pendingThumbs);
    }
  }

  enqueueThumbnails(books: LibraryBook[]): void {
    for (const book of books) {
      if (book.format === 'pdf') continue;
      if (this.queuedIds.has(book.id)) continue;
      this.queuedIds.add(book.id);
      this.thumbQueue.push(book);
    }
    this.pumpThumbnailQueue();
  }

  private pumpThumbnailQueue(): void {
    while (this.activeThumbWorkers < this.maxThumbConcurrency && this.thumbQueue.length > 0) {
      const next = this.thumbQueue.shift();
      if (!next) break;
      this.activeThumbWorkers++;
      void this.generateThumbnail(next).finally(() => {
        this.activeThumbWorkers--;
        this.queuedIds.delete(next.id);
        this.pumpThumbnailQueue();
      });
    }
  }

  private async generateThumbnail(book: LibraryBook): Promise<void> {
    const adapter = this.createAdapter(book.filePath, book.format);
    try {
      const opened = await adapter.open();
      const cover = await adapter.getCoverImage();
      if (cover && cover.data.byteLength > 0) {
        const thumbPath = this.persistence.getThumbnailPath(book.id);
        const optimized = optimizeCoverThumbnail(cover.data);
        await fs.writeFile(thumbPath, optimized);
        this.persistence.markThumbnailReady(book.id, opened.pages.length || null);
        this.emitUpdate();
      } else if (opened.pages.length > 0) {
        this.persistence.markBookOpened(book.id, opened.metadata, opened.pages.length);
      }
    } catch (err) {
      console.warn(`[scanner] Thumbnail extraction failed for ${book.fileName}:`, err);
    } finally {
      await adapter.close();
    }
  }

  async savePdfThumbnail(
    bookId: string,
    pageCount: number,
    imageBytes: Uint8Array,
  ): Promise<boolean> {
    const book = this.persistence.getBook(bookId);
    if (!book || imageBytes.byteLength === 0) return false;
    const thumbPath = this.persistence.getThumbnailPath(bookId);
    await fs.writeFile(thumbPath, Buffer.from(imageBytes));
    this.persistence.markThumbnailReady(bookId, pageCount > 0 ? pageCount : null);
    this.emitUpdate();
    return true;
  }
}

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_READER_SETTINGS,
  type BookFormat,
  type BookMetadata,
  type Bookmark,
  type LibraryBook,
  type LibrarySnapshot,
  type ReaderSettings,
  type ReadingProgress,
} from '@shared/types';
import { cleanDisplayTitle } from '@main/formats/detectFormat';

interface PersistedLibraryFile {
  version: 1;
  folders: string[];
  books: LibraryBook[];
}

export function normalizePathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function computeBookId(filePath: string): string {
  return crypto
    .createHash('sha1')
    .update(normalizePathKey(filePath))
    .digest('hex')
    .slice(0, 16);
}

async function atomicWriteJson(targetPath: string, data: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpPath, targetPath);
}

export class AppPersistence {
  readonly libraryPath: string;
  readonly settingsPath: string;
  readonly thumbnailsDir: string;

  private folders: string[] = [];
  private booksById = new Map<string, LibraryBook>();
  private settings: ReaderSettings = { ...DEFAULT_READER_SETTINGS };

  private libraryDirty = false;
  private settingsDirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly userDataDir: string) {
    this.libraryPath = path.join(userDataDir, 'library.json');
    this.settingsPath = path.join(userDataDir, 'settings.json');
    this.thumbnailsDir = path.join(userDataDir, 'thumbnails');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.userDataDir, { recursive: true });
    await fs.mkdir(this.thumbnailsDir, { recursive: true });

    try {
      const raw = await fs.readFile(this.libraryPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedLibraryFile>;
      if (Array.isArray(parsed.folders)) {
        this.folders = parsed.folders.filter((f): f is string => typeof f === 'string');
      }
      if (Array.isArray(parsed.books)) {
        this.booksById.clear();
        for (const book of parsed.books) {
          if (book && typeof book.id === 'string' && typeof book.filePath === 'string') {
            this.booksById.set(book.id, {
              ...book,
              bookmarks: Array.isArray(book.bookmarks) ? book.bookmarks : [],
            });
          }
        }
      }
    } catch {
      // Fresh library
    }

    try {
      const raw = await fs.readFile(this.settingsPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
      this.settings = { ...DEFAULT_READER_SETTINGS, ...parsed };
    } catch {
      this.settings = { ...DEFAULT_READER_SETTINGS };
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, 250);
  }

  async flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const saveLib = this.libraryDirty;
    const saveSettings = this.settingsDirty;
    this.libraryDirty = false;
    this.settingsDirty = false;

    if (!saveLib && !saveSettings) {
      return this.writeChain;
    }

    const libSnapshot: PersistedLibraryFile | null = saveLib
      ? {
          version: 1,
          folders: [...this.folders],
          books: Array.from(this.booksById.values()),
        }
      : null;

    const settingsSnapshot: ReaderSettings | null = saveSettings
      ? { ...this.settings }
      : null;

    this.writeChain = this.writeChain
      .then(async () => {
        if (libSnapshot) {
          await atomicWriteJson(this.libraryPath, libSnapshot);
        }
        if (settingsSnapshot) {
          await atomicWriteJson(this.settingsPath, settingsSnapshot);
        }
      })
      .catch((err) => {
        console.error('[persistence] Failed to flush state:', err);
      });

    return this.writeChain;
  }

  getThumbnailPath(bookId: string): string {
    return path.join(this.thumbnailsDir, `${bookId}.thumb`);
  }

  getFolders(): string[] {
    return [...this.folders];
  }

  getLibrarySnapshot(scanning = false): LibrarySnapshot {
    const books = Array.from(this.booksById.values()).sort((a, b) => {
      if (a.lastReadAt && b.lastReadAt) return b.lastReadAt - a.lastReadAt;
      if (a.lastReadAt) return -1;
      if (b.lastReadAt) return 1;
      return b.addedAt - a.addedAt;
    });
    return {
      folders: [...this.folders],
      books,
      scanning,
    };
  }

  getBook(bookId: string): LibraryBook | undefined {
    return this.booksById.get(bookId);
  }

  getBookByPath(filePath: string): LibraryBook | undefined {
    return this.booksById.get(computeBookId(filePath));
  }

  addFolder(folderPath: string): boolean {
    const resolved = path.resolve(folderPath);
    const key = normalizePathKey(resolved);
    if (this.folders.some((f) => normalizePathKey(f) === key)) {
      return false;
    }
    this.folders.push(resolved);
    this.libraryDirty = true;
    this.scheduleFlush();
    return true;
  }

  removeFolder(folderPath: string): void {
    const key = normalizePathKey(folderPath);
    this.folders = this.folders.filter((f) => normalizePathKey(f) !== key);
    for (const [id, book] of this.booksById.entries()) {
      if (normalizePathKey(book.folderPath) === key) {
        this.booksById.delete(id);
      }
    }
    this.libraryDirty = true;
    this.scheduleFlush();
  }

  removeBook(bookId: string): void {
    if (this.booksById.delete(bookId)) {
      this.libraryDirty = true;
      this.scheduleFlush();
    }
  }

  ensureBookForFile(params: {
    filePath: string;
    folderPath: string;
    format: BookFormat;
    fileSize: number;
    modifiedAt: number;
    metadata?: Partial<BookMetadata>;
    pageCount?: number | null;
  }): LibraryBook {
    const resolved = path.resolve(params.filePath);
    const id = computeBookId(resolved);
    const existing = this.booksById.get(id);
    const parentName = path.basename(path.dirname(resolved)) || 'Library';
    const defaultTitle = cleanDisplayTitle(resolved);

    if (existing) {
      const fileChanged =
        existing.modifiedAt !== params.modifiedAt || existing.fileSize !== params.fileSize;
      const updated: LibraryBook = {
        ...existing,
        filePath: resolved,
        fileName: path.basename(resolved),
        folderPath: params.folderPath || existing.folderPath,
        format: params.format,
        fileSize: params.fileSize,
        modifiedAt: params.modifiedAt,
        title: params.metadata?.title || existing.title || defaultTitle,
        series: params.metadata?.series || existing.series || parentName,
        author: params.metadata?.author ?? existing.author,
        pageCount: params.pageCount ?? existing.pageCount,
        thumbnailReady: fileChanged ? false : existing.thumbnailReady,
      };
      this.booksById.set(id, updated);
      this.libraryDirty = true;
      this.scheduleFlush();
      return updated;
    }

    const created: LibraryBook = {
      id,
      filePath: resolved,
      fileName: path.basename(resolved),
      folderPath: params.folderPath,
      format: params.format,
      title: params.metadata?.title || defaultTitle,
      series: params.metadata?.series || parentName,
      author: params.metadata?.author,
      fileSize: params.fileSize,
      modifiedAt: params.modifiedAt,
      addedAt: Date.now(),
      pageCount: params.pageCount ?? null,
      thumbnailReady: false,
      lastReadAt: null,
      progress: null,
      bookmarks: [],
    };
    this.booksById.set(id, created);
    this.libraryDirty = true;
    this.scheduleFlush();
    return created;
  }

  pruneMissingFolderBooks(folderPath: string, discoveredIds: Set<string>): void {
    const folderKey = normalizePathKey(folderPath);
    let removedAny = false;
    for (const [id, book] of this.booksById.entries()) {
      if (normalizePathKey(book.folderPath) === folderKey && !discoveredIds.has(id)) {
        this.booksById.delete(id);
        removedAny = true;
      }
    }
    if (removedAny) {
      this.libraryDirty = true;
      this.scheduleFlush();
    }
  }

  markBookOpened(bookId: string, metadata: BookMetadata, pageCount: number | null): void {
    const book = this.booksById.get(bookId);
    if (!book) return;
    book.lastReadAt = Date.now();
    if (metadata.title) book.title = metadata.title;
    if (metadata.series) book.series = metadata.series;
    if (metadata.author) book.author = metadata.author;
    if (pageCount != null && pageCount > 0) {
      book.pageCount = pageCount;
    }
    this.libraryDirty = true;
    this.scheduleFlush();
  }

  markThumbnailReady(bookId: string, pageCount?: number | null): void {
    const book = this.booksById.get(bookId);
    if (!book) return;
    book.thumbnailReady = true;
    if (pageCount != null && pageCount > 0) {
      book.pageCount = pageCount;
    }
    this.libraryDirty = true;
    this.scheduleFlush();
  }

  saveProgress(bookId: string, progress: ReadingProgress): void {
    const book = this.booksById.get(bookId);
    if (!book) return;
    book.progress = {
      ...progress,
      ratio: Math.max(0, Math.min(1, progress.ratio)),
      updatedAt: progress.updatedAt || Date.now(),
    };
    if (progress.pageCount > 0) {
      book.pageCount = progress.pageCount;
    }
    book.lastReadAt = Date.now();
    this.libraryDirty = true;
    this.scheduleFlush();
  }

  addBookmark(bookId: string, pageIndex: number, label?: string): Bookmark[] {
    const book = this.booksById.get(bookId);
    if (!book) return [];

    const existing = book.bookmarks.find((b) => b.pageIndex === pageIndex);
    if (existing) {
      if (label !== undefined) {
        existing.label = label.trim() || `Page ${pageIndex + 1}`;
        this.libraryDirty = true;
        this.scheduleFlush();
      }
      return [...book.bookmarks].sort((a, b) => a.pageIndex - b.pageIndex);
    }

    const bookmark: Bookmark = {
      id: crypto.randomUUID(),
      pageIndex,
      label: label?.trim() || `Page ${pageIndex + 1}`,
      createdAt: Date.now(),
    };
    book.bookmarks.push(bookmark);
    book.bookmarks.sort((a, b) => a.pageIndex - b.pageIndex);
    this.libraryDirty = true;
    this.scheduleFlush();
    return [...book.bookmarks];
  }

  removeBookmark(bookId: string, bookmarkId: string): Bookmark[] {
    const book = this.booksById.get(bookId);
    if (!book) return [];
    book.bookmarks = book.bookmarks.filter((b) => b.id !== bookmarkId);
    this.libraryDirty = true;
    this.scheduleFlush();
    return [...book.bookmarks];
  }

  getSettings(): ReaderSettings {
    return { ...this.settings };
  }

  updateSettings(partial: Partial<ReaderSettings>): ReaderSettings {
    this.settings = {
      ...this.settings,
      ...partial,
      zoom: Math.max(0.5, Math.min(3, partial.zoom ?? this.settings.zoom)),
      pageGap: Math.max(0, Math.min(48, partial.pageGap ?? this.settings.pageGap)),
      wheelScrollSpeed: Math.max(
        0.4,
        Math.min(3, partial.wheelScrollSpeed ?? this.settings.wheelScrollSpeed),
      ),
    };
    this.settingsDirty = true;
    this.scheduleFlush();
    return this.getSettings();
  }
}

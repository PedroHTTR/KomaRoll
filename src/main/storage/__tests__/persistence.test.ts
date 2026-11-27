import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPersistence } from '../persistence';

describe('AppPersistence', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manga-persist-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('persists folders, books, reading progress, bookmarks, and settings across restarts', async () => {
    const store1 = new AppPersistence(tmpDir);
    await store1.init();

    const folder = path.join(tmpDir, 'MangaShelf');
    expect(store1.addFolder(folder)).toBe(true);
    expect(store1.addFolder(folder)).toBe(false); // deduplicated

    const bookPath = path.join(folder, 'OnePiece_Vol01.cbz');
    const book = store1.ensureBookForFile({
      filePath: bookPath,
      folderPath: folder,
      format: 'cbz',
      fileSize: 1024,
      modifiedAt: 1700000000000,
      pageCount: 180,
    });

    store1.saveProgress(book.id, {
      pageIndex: 42,
      pageCount: 180,
      ratio: 42 / 179,
      updatedAt: Date.now(),
    });

    const bms = store1.addBookmark(book.id, 42, 'Epic double spread');
    expect(bms).toHaveLength(1);
    expect(bms[0].label).toBe('Epic double spread');

    store1.updateSettings({ direction: 'ltr', scrollMode: 'snap', zoom: 1.5 });
    await store1.flushNow();

    // Reload from disk in a fresh instance
    const store2 = new AppPersistence(tmpDir);
    await store2.init();

    const snapshot = store2.getLibrarySnapshot();
    expect(snapshot.folders).toHaveLength(1);
    expect(snapshot.books).toHaveLength(1);
    expect(snapshot.books[0].progress?.pageIndex).toBe(42);
    expect(snapshot.books[0].bookmarks).toHaveLength(1);
    expect(snapshot.books[0].bookmarks[0].label).toBe('Epic double spread');

    const settings = store2.getSettings();
    expect(settings.direction).toBe('ltr');
    expect(settings.scrollMode).toBe('snap');
    expect(settings.zoom).toBe(1.5);

    const remaining = store2.removeBookmark(book.id, bms[0].id);
    expect(remaining).toHaveLength(0);
  });
});

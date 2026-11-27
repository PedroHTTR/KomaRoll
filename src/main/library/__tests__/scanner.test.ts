import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBookAdapter } from '@main/formats/sessionManager';
import { TINY_PNG_BUFFER, writeZipFile } from '@main/formats/__tests__/testZipHelper';
import { AppPersistence } from '@main/storage/persistence';
import { LibraryScanner } from '../scanner';

describe('LibraryScanner', () => {
  let tmpDir: string;
  let userDataDir: string;
  let mangaDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manga-scan-'));
    userDataDir = path.join(tmpDir, 'userdata');
    mangaDir = path.join(tmpDir, 'library');
    await fs.mkdir(path.join(mangaDir, 'Vagabond'), { recursive: true });
    await fs.mkdir(path.join(mangaDir, 'Akira'), { recursive: true });

    await writeZipFile(path.join(mangaDir, 'Vagabond', 'Vol_01.cbz'), [
      { name: '001.png', content: TINY_PNG_BUFFER },
      { name: '002.png', content: TINY_PNG_BUFFER },
    ]);

    await fs.writeFile(
      path.join(mangaDir, 'Akira', 'Akira_01.pdf'),
      Buffer.from('%PDF-1.4\n%%EOF'),
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('recursively discovers books, assigns series names from folders, and generates CBZ thumbnails', async () => {
    const persistence = new AppPersistence(userDataDir);
    await persistence.init();
    persistence.addFolder(mangaDir);

    const scanner = new LibraryScanner(persistence, createBookAdapter, () => {});
    const snapshot = await scanner.scanAllFolders();

    expect(snapshot.books).toHaveLength(2);
    const cbzBook = snapshot.books.find((b) => b.format === 'cbz');
    const pdfBook = snapshot.books.find((b) => b.format === 'pdf');

    expect(cbzBook?.series).toBe('Vagabond');
    expect(pdfBook?.series).toBe('Akira');

    // Wait briefly for background thumbnail worker to finish extracting CBZ cover
    await new Promise((resolve) => setTimeout(resolve, 350));
    const updated = persistence.getBook(cbzBook!.id);
    expect(updated?.thumbnailReady).toBe(true);
    expect(updated?.pageCount).toBe(2);

    const thumbStat = await fs.stat(persistence.getThumbnailPath(cbzBook!.id));
    expect(thumbStat.size).toBe(TINY_PNG_BUFFER.length);
  });
});

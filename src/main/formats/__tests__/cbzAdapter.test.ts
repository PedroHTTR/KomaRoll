import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CbzAdapter } from '../cbzAdapter';
import { TINY_PNG_BUFFER, writeZipFile } from './testZipHelper';

describe('CbzAdapter', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manga-cbz-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('opens CBZ, filters junk entries, sorts pages naturally, reads ComicInfo, and extracts bytes', async () => {
    const cbzPath = path.join(tmpDir, 'test_manga.cbz');
    await writeZipFile(cbzPath, [
      { name: '__MACOSX/._page1.png', content: TINY_PNG_BUFFER },
      { name: 'page10.png', content: TINY_PNG_BUFFER },
      { name: 'page2.png', content: TINY_PNG_BUFFER },
      { name: 'page1.png', content: TINY_PNG_BUFFER },
      {
        name: 'ComicInfo.xml',
        content: `<ComicInfo><Title>Chapter 1</Title><Series>KomaTest</Series><Manga>Yes</Manga></ComicInfo>`,
      },
    ]);

    const adapter = new CbzAdapter(cbzPath);
    try {
      const opened = await adapter.open();
      expect(opened.metadata.title).toBe('Chapter 1');
      expect(opened.metadata.series).toBe('KomaTest');
      expect(opened.metadata.defaultDirection).toBe('rtl');
      expect(opened.pages.map((p) => p.sourceRef)).toEqual([
        'page1.png',
        'page2.png',
        'page10.png',
      ]);

      const page0 = await adapter.getPagePayload(0);
      expect(page0.mimeType).toBe('image/png');
      expect(page0.data.equals(TINY_PNG_BUFFER)).toBe(true);

      const cover = await adapter.getCoverImage();
      expect(cover?.data.equals(TINY_PNG_BUFFER)).toBe(true);
    } finally {
      await adapter.close();
    }
  });
});

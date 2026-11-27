import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  detectBookFormat,
  isSupportedImagePath,
  naturalCompare,
  parseComicInfoXml,
} from '../detectFormat';
import { TINY_PNG_BUFFER, writeZipFile } from './testZipHelper';

describe('detectFormat & archive helpers', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manga-detect-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects CBZ, EPUB, RAR, PDF, and misnamed ZIP-as-CBR via magic bytes', async () => {
    const cbzPath = path.join(tmpDir, 'vol1.cbz');
    await writeZipFile(cbzPath, [{ name: '001.png', content: TINY_PNG_BUFFER }]);
    expect(await detectBookFormat(cbzPath)).toBe('cbz');

    // A ZIP archive mistakenly given a .cbr extension should route to cbz seamlessly
    const fakeCbrPath = path.join(tmpDir, 'misnamed.cbr');
    await writeZipFile(fakeCbrPath, [{ name: '001.png', content: TINY_PNG_BUFFER }]);
    expect(await detectBookFormat(fakeCbrPath)).toBe('cbz');

    const epubPath = path.join(tmpDir, 'manga.epub');
    await writeZipFile(epubPath, [{ name: 'mimetype', content: 'application/epub+zip' }]);
    expect(await detectBookFormat(epubPath)).toBe('epub');

    const rarPath = path.join(tmpDir, 'real.cbr');
    await fs.writeFile(rarPath, Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]));
    expect(await detectBookFormat(rarPath)).toBe('cbr');

    const pdfPath = path.join(tmpDir, 'book.pdf');
    await fs.writeFile(pdfPath, Buffer.from('%PDF-1.4\n%%EOF'));
    expect(await detectBookFormat(pdfPath)).toBe('pdf');
  });

  it('sorts page filenames naturally and filters junk archive paths', () => {
    const names = ['ch1/page10.jpg', 'ch1/page2.jpg', 'ch1/page1.jpg', 'ch1/page100.jpg'];
    names.sort(naturalCompare);
    expect(names).toEqual([
      'ch1/page1.jpg',
      'ch1/page2.jpg',
      'ch1/page10.jpg',
      'ch1/page100.jpg',
    ]);

    expect(isSupportedImagePath('pages/001.webp')).toBe(true);
    expect(isSupportedImagePath('__MACOSX/pages/._001.jpg')).toBe(false);
    expect(isSupportedImagePath('.DS_Store')).toBe(false);
    expect(isSupportedImagePath('ComicInfo.xml')).toBe(false);
    expect(isSupportedImagePath('Thumbs.db')).toBe(false);
  });

  it('parses ComicInfo.xml metadata including RTL manga flag', () => {
    const xml = `
      <ComicInfo>
        <Title>Volume 01</Title>
        <Series>Berserk</Series>
        <Writer>Kentaro Miura</Writer>
        <Manga>YesAndRightToLeft</Manga>
      </ComicInfo>
    `;
    expect(parseComicInfoXml(xml)).toEqual({
      title: 'Volume 01',
      series: 'Berserk',
      author: 'Kentaro Miura',
      defaultDirection: 'rtl',
    });
  });
});

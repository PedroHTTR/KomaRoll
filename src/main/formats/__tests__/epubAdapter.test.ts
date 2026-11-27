import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EpubAdapter, extractSingleImageFromXhtml } from '../epubAdapter';
import { TINY_PNG_BUFFER, writeZipFile } from './testZipHelper';

describe('EpubAdapter', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manga-epub-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('classifies fixed-layout image wrappers vs text XHTML pages accurately', () => {
    const imgWrapper = `
      <html xmlns="http://www.w3.org/1999/xhtml">
        <body><div><img src="../images/p001.png" alt="" /></div></body>
      </html>
    `;
    expect(extractSingleImageFromXhtml(imgWrapper)).toBe('../images/p001.png');

    const svgWrapper = `
      <html xmlns="http://www.w3.org/1999/xhtml">
        <body><svg><image xlink:href="img/p002.jpg" width="1200" height="1800"/></svg></body>
      </html>
    `;
    expect(extractSingleImageFromXhtml(svgWrapper)).toBe('img/p002.jpg');

    const textChapter = `
      <html xmlns="http://www.w3.org/1999/xhtml">
        <body>
          <h1>Chapter 1</h1>
          <p>This is a full prose paragraph with plenty of text content that should render as XHTML.</p>
          <img src="ornament.png" />
        </body>
      </html>
    `;
    expect(extractSingleImageFromXhtml(textChapter)).toBeNull();
  });

  it('parses manga EPUB with RTL spine, extracts native image pages, and falls back to XHTML for mixed pages', async () => {
    const epubPath = path.join(tmpDir, 'sample_manga.epub');
    await writeZipFile(epubPath, [
      { name: 'mimetype', content: 'application/epub+zip' },
      {
        name: 'META-INF/container.xml',
        content: `<?xml version="1.0"?>
          <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
            <rootfiles>
              <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
            </rootfiles>
          </container>`,
      },
      {
        name: 'OEBPS/content.opf',
        content: `<?xml version="1.0" encoding="utf-8"?>
          <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
            <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
              <dc:title>Samurai Strip</dc:title>
              <dc:creator>Test Author</dc:creator>
            </metadata>
            <manifest>
              <item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>
              <item id="img1" href="images/p1.png" media-type="image/png"/>
              <item id="p1" href="text/p1.xhtml" media-type="application/xhtml+xml"/>
              <item id="afterword" href="text/afterword.xhtml" media-type="application/xhtml+xml"/>
            </manifest>
            <spine page-progression-direction="rtl">
              <itemref idref="p1"/>
              <itemref idref="afterword"/>
            </spine>
          </package>`,
      },
      { name: 'OEBPS/images/cover.png', content: TINY_PNG_BUFFER },
      { name: 'OEBPS/images/p1.png', content: TINY_PNG_BUFFER },
      {
        name: 'OEBPS/text/p1.xhtml',
        content: `<html><body><img src="../images/p1.png"/></body></html>`,
      },
      {
        name: 'OEBPS/text/afterword.xhtml',
        content: `<html><body><h1>Author's Note</h1><p>Thank you for reading this manga volume! Here are some extra thoughts on the creation process.</p></body></html>`,
      },
    ]);

    const adapter = new EpubAdapter(epubPath);
    try {
      const opened = await adapter.open();
      expect(opened.metadata.title).toBe('Samurai Strip');
      expect(opened.metadata.author).toBe('Test Author');
      expect(opened.metadata.defaultDirection).toBe('rtl');
      expect(opened.pages).toHaveLength(2);

      // First spine page resolved directly to raster image
      expect(opened.pages[0].kind).toBe('image');
      expect(opened.pages[0].sourceRef).toBe('OEBPS/images/p1.png');

      // Second spine page fell back to XHTML
      expect(opened.pages[1].kind).toBe('xhtml');
      expect(opened.pages[1].sourceRef).toBe('OEBPS/text/afterword.xhtml');

      const imgPayload = await adapter.getPagePayload(0);
      expect(imgPayload.mimeType).toBe('image/png');
      expect(imgPayload.data.equals(TINY_PNG_BUFFER)).toBe(true);

      const xhtmlPayload = await adapter.getAsset('OEBPS/text/afterword.xhtml');
      expect(xhtmlPayload?.data.toString('utf8')).toContain("Author's Note");

      const cover = await adapter.getCoverImage();
      expect(cover?.data.equals(TINY_PNG_BUFFER)).toBe(true);
    } finally {
      await adapter.close();
    }
  });
});

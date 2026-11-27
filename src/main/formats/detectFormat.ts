import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { BookFormat, BookMetadata } from '@shared/types';

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.gif',
  '.bmp',
]);

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.opf': 'application/oebps-package+xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
};

export function naturalCompare(a: string, b: string): number {
  return naturalCollator.compare(a, b);
}

export function isSupportedImagePath(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) return false;
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (seg === '__MACOSX' || seg.startsWith('.')) {
      return false;
    }
  }
  const baseName = segments[segments.length - 1].toLowerCase();
  if (baseName === 'thumbs.db' || baseName === 'desktop.ini') {
    return false;
  }
  const ext = path.posix.extname(baseName);
  return IMAGE_EXTENSIONS.has(ext);
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function cleanDisplayTitle(filePath: string): string {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  return base.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim() || base;
}

export function isSupportedBookExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.cbz' || ext === '.cbr' || ext === '.epub' || ext === '.pdf';
}

/**
 * Detects book format using file magic bytes first, falling back to file extension.
 * Notably handles `.cbr` archives that are actually renamed ZIP files.
 */
export async function detectBookFormat(filePath: string): Promise<BookFormat> {
  const ext = path.extname(filePath).toLowerCase();
  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, 16, 0);

    if (bytesRead >= 4) {
      // PDF: "%PDF"
      if (
        header[0] === 0x25 &&
        header[1] === 0x50 &&
        header[2] === 0x44 &&
        header[3] === 0x46
      ) {
        return 'pdf';
      }

      // RAR4 ("Rar!\x1a\x07\x00") or RAR5 ("Rar!\x1a\x07\x01\x00")
      if (
        bytesRead >= 7 &&
        header[0] === 0x52 &&
        header[1] === 0x61 &&
        header[2] === 0x72 &&
        header[3] === 0x21 &&
        header[4] === 0x1a &&
        header[5] === 0x07
      ) {
        return 'cbr';
      }

      // ZIP ("PK\x03\x04", "PK\x05\x06", "PK\x07\x08")
      if (
        header[0] === 0x50 &&
        header[1] === 0x4b &&
        ((header[2] === 0x03 && header[3] === 0x04) ||
          (header[2] === 0x05 && header[3] === 0x06) ||
          (header[2] === 0x07 && header[3] === 0x08))
      ) {
        if (ext === '.epub') {
          return 'epub';
        }
        return 'cbz';
      }
    }
  } finally {
    await handle.close();
  }

  switch (ext) {
    case '.cbz':
      return 'cbz';
    case '.cbr':
      return 'cbr';
    case '.epub':
      return 'epub';
    case '.pdf':
      return 'pdf';
    default:
      throw new Error(`Unsupported file format: ${path.basename(filePath)}`);
  }
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export function parseComicInfoXml(xmlContent: string): Partial<BookMetadata> {
  try {
    const parsed = xmlParser.parse(xmlContent);
    const info = parsed?.ComicInfo;
    if (!info || typeof info !== 'object') return {};

    const result: Partial<BookMetadata> = {};
    if (typeof info.Title === 'string' && info.Title.trim()) {
      result.title = info.Title.trim();
    }
    if (typeof info.Series === 'string' && info.Series.trim()) {
      result.series = info.Series.trim();
    }
    if (typeof info.Writer === 'string' && info.Writer.trim()) {
      result.author = info.Writer.trim();
    }
    if (typeof info.Manga === 'string') {
      const val = info.Manga.toLowerCase();
      if (val === 'yesandrighttoleft' || val === 'yes') {
        result.defaultDirection = 'rtl';
      } else if (val === 'no') {
        result.defaultDirection = 'ltr';
      }
    }
    return result;
  } catch {
    return {};
  }
}

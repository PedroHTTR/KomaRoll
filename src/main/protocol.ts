import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import type { BookSessionManager } from '@main/formats/sessionManager';
import type { AppPersistence } from '@main/storage/persistence';

export const MANGA_SCHEME = 'manga-page';

export function registerMangaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MANGA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

function sniffImageMime(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') {
    return 'image/gif';
  }
  return 'image/jpeg';
}

export function setupMangaProtocol(
  sessionManager: BookSessionManager,
  persistence: AppPersistence,
): void {
  protocol.handle(MANGA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const host = url.hostname;
      const parts = url.pathname.split('/').filter(Boolean);

      // 1. Cached cover thumbnails: manga-page://thumb/<bookId>
      if (host === 'thumb' && parts.length >= 1) {
        const bookId = decodeURIComponent(parts[0]);
        const thumbPath = persistence.getThumbnailPath(bookId);
        try {
          const data = await fsp.readFile(thumbPath);
          return new Response(new Uint8Array(data), {
            status: 200,
            headers: {
              'Content-Type': sniffImageMime(data),
              'Cache-Control': 'public, max-age=86400',
            },
          });
        } catch {
          return new Response('Thumbnail not found', { status: 404 });
        }
      }

      // 2. Raw PDF streaming with Range support: manga-page://file/<bookId>
      if (host === 'file' && parts.length >= 1) {
        const bookId = decodeURIComponent(parts[0]);
        const filePath =
          sessionManager.getFilePath(bookId) ?? persistence.getBook(bookId)?.filePath;
        if (!filePath) {
          return new Response('File not found', { status: 404 });
        }

        const stat = await fsp.stat(filePath);
        const totalSize = stat.size;
        const rangeHeader = request.headers.get('range');

        if (rangeHeader) {
          const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
          if (match) {
            const start = match[1] ? Number.parseInt(match[1], 10) : 0;
            const end = match[2]
              ? Math.min(Number.parseInt(match[2], 10), totalSize - 1)
              : totalSize - 1;

            if (start >= totalSize || start > end) {
              return new Response(null, {
                status: 416,
                headers: { 'Content-Range': `bytes */${totalSize}` },
              });
            }

            const chunkSize = end - start + 1;
            const nodeStream = fs.createReadStream(filePath, { start, end });
            const webStream = Readable.toWeb(nodeStream) as ReadableStream;
            return new Response(webStream, {
              status: 206,
              headers: {
                'Content-Type': 'application/pdf',
                'Content-Length': String(chunkSize),
                'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges': 'bytes',
              },
            });
          }
        }

        const nodeStream = fs.createReadStream(filePath);
        const webStream = Readable.toWeb(nodeStream) as ReadableStream;
        return new Response(webStream, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(totalSize),
            'Accept-Ranges': 'bytes',
          },
        });
      }

      // 3. Book pages and EPUB internal assets:
      //    manga-page://book/<bookId>/page/<pageIndex>
      //    manga-page://book/<bookId>/epub-asset/<path...>
      if (host === 'book' && parts.length >= 3) {
        const bookId = decodeURIComponent(parts[0]);
        const routeType = parts[1];

        if (routeType === 'page') {
          const pageIndex = Number.parseInt(parts[2], 10);
          if (!Number.isFinite(pageIndex) || pageIndex < 0) {
            return new Response('Invalid page index', { status: 400 });
          }
          const payload = await sessionManager.getPagePayload(bookId, pageIndex);
          return new Response(new Uint8Array(payload.data), {
            status: 200,
            headers: {
              'Content-Type': payload.mimeType,
              'Cache-Control': 'private, max-age=3600',
            },
          });
        }

        if (routeType === 'epub-asset') {
          const relativePath = parts
            .slice(2)
            .map((segment) => decodeURIComponent(segment))
            .join('/');
          const payload = await sessionManager.getAsset(bookId, relativePath);
          if (!payload) {
            return new Response('EPUB asset not found', { status: 404 });
          }
          return new Response(new Uint8Array(payload.data), {
            status: 200,
            headers: {
              'Content-Type': payload.mimeType,
              'Cache-Control': 'private, max-age=3600',
            },
          });
        }
      }

      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error('[protocol] Error serving manga-page request:', request.url, err);
      return new Response('Internal server error', { status: 500 });
    }
  });
}

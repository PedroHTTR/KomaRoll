import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createExtractorFromFile, type Extractor } from 'node-unrar-js';
import type { BookMetadata, PageDescriptor } from '@shared/types';
import {
  cleanDisplayTitle,
  getMimeType,
  isSupportedImagePath,
  naturalCompare,
  parseComicInfoXml,
} from './detectFormat';
import {
  LruPageCache,
  type BookAdapter,
  type OpenedAdapterResult,
  type PagePayload,
} from './types';

let cachedWasmBinaryPromise: Promise<ArrayBuffer | undefined> | null = null;

/**
 * Loads `unrar.wasm` once and resolves unpacked ASAR paths when packaged in Electron.
 */
function loadUnrarWasmBinary(): Promise<ArrayBuffer | undefined> {
  if (cachedWasmBinaryPromise) return cachedWasmBinaryPromise;

  cachedWasmBinaryPromise = (async () => {
    try {
      let wasmPath: string;
      if (typeof require === 'function' && typeof require.resolve === 'function') {
        wasmPath = require.resolve('node-unrar-js/dist/js/unrar.wasm');
      } else {
        wasmPath = path.resolve(
          process.cwd(),
          'node_modules',
          'node-unrar-js',
          'dist',
          'js',
          'unrar.wasm',
        );
      }

      // Electron ASAR cannot stream WASM directly from inside app.asar; redirect to app.asar.unpacked
      const asarSegment = `app.asar${path.sep}`;
      if (wasmPath.includes(asarSegment) && !wasmPath.includes('app.asar.unpacked')) {
        wasmPath = wasmPath.replace(asarSegment, `app.asar.unpacked${path.sep}`);
      }

      const buf = await fs.readFile(wasmPath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch {
      return undefined;
    }
  })();

  return cachedWasmBinaryPromise;
}

/**
 * `node-unrar-js` binds each Extractor onto a shared singleton WASM instance (`unrar.extractor`).
 * Serializing operations through this lightweight async lock prevents races when background
 * thumbnail workers and the active reader touch CBR archives concurrently.
 */
let unrarMutex: Promise<void> = Promise.resolve();

function withUnrarLock<T>(operation: () => Promise<T> | T): Promise<T> {
  const prev = unrarMutex;
  let release!: () => void;
  unrarMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(operation).finally(() => release());
}

export class CbrAdapter implements BookAdapter {
  readonly format = 'cbr' as const;

  private extractor: Extractor | null = null;
  private tempDir: string | null = null;
  private pages: PageDescriptor[] = [];
  private safeNameByEntry = new Map<string, string>();
  private extractedEntries = new Set<string>();
  private readonly cache = new LruPageCache();

  constructor(private readonly filePath: string) {}

  private async ensureActiveExtractor(): Promise<Extractor> {
    if (!this.tempDir) {
      throw new Error('CBR archive is not open');
    }
    const wasmBinary = await loadUnrarWasmBinary();
    // Re-bind this adapter's extractor onto the shared WASM singleton before operating
    this.extractor = await createExtractorFromFile({
      wasmBinary,
      filepath: this.filePath,
      targetPath: this.tempDir,
      filenameTransform: (name) =>
        this.safeNameByEntry.get(name) ??
        `misc_${Buffer.from(name).toString('hex').slice(0, 16)}`,
    });
    return this.extractor;
  }

  async open(): Promise<OpenedAdapterResult> {
    this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'komaroll-cbr-'));

    try {
      const { imageNames, comicInfoEntryName } = await withUnrarLock(async () => {
        const extractor = await this.ensureActiveExtractor();
        const list = extractor.getFileList();

        const images: string[] = [];
        let comicInfo: string | null = null;

        for (const header of list.fileHeaders) {
          if (header.flags.directory) continue;
          if (header.name.toLowerCase().endsWith('comicinfo.xml')) {
            comicInfo = header.name;
          }
          if (isSupportedImagePath(header.name)) {
            images.push(header.name);
          }
        }

        return { imageNames: images, comicInfoEntryName: comicInfo };
      });

      imageNames.sort(naturalCompare);

      this.safeNameByEntry.clear();
      imageNames.forEach((entryName, idx) => {
        const ext = path.extname(entryName).toLowerCase() || '.img';
        this.safeNameByEntry.set(entryName, `p_${String(idx).padStart(5, '0')}${ext}`);
      });
      if (comicInfoEntryName) {
        this.safeNameByEntry.set(comicInfoEntryName, 'ComicInfo.xml');
      }

      const metadata: BookMetadata = {
        title: cleanDisplayTitle(this.filePath),
      };

      if (comicInfoEntryName) {
        try {
          await this.extractBatch([comicInfoEntryName]);
          const safePath = path.join(this.tempDir, this.safeNameByEntry.get(comicInfoEntryName)!);
          const xmlText = await fs.readFile(safePath, 'utf8');
          Object.assign(metadata, parseComicInfoXml(xmlText));
        } catch {
          // Ignore malformed ComicInfo.xml
        }
      }

      this.pages = imageNames.map((entryName, index) => ({
        index,
        kind: 'image',
        sourceRef: entryName,
        mimeType: getMimeType(entryName),
      }));

      return { metadata, pages: this.pages };
    } catch (err) {
      await this.close();
      throw err;
    }
  }

  private async extractBatch(entryNames: string[]): Promise<void> {
    const needed = entryNames.filter((name) => !this.extractedEntries.has(name));
    if (needed.length === 0 || !this.tempDir) return;

    await withUnrarLock(async () => {
      const stillNeeded = needed.filter((name) => !this.extractedEntries.has(name));
      if (stillNeeded.length === 0 || !this.tempDir) return;

      const extractor = await this.ensureActiveExtractor();
      const extracted = extractor.extract({ files: stillNeeded });
      for (const file of extracted.files) {
        this.extractedEntries.add(file.fileHeader.name);
      }
    });
  }

  async getPagePayload(pageIndex: number): Promise<PagePayload> {
    if (!this.tempDir) {
      throw new Error('CBR archive is not open');
    }

    const page = this.pages[pageIndex];
    if (!page) {
      throw new Error(`CBR page index out of bounds: ${pageIndex}`);
    }

    const cacheKey = `p:${pageIndex}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // Extract requested page + next 4 pages in one pass to optimize solid RAR archives
    const batch: string[] = [];
    for (let i = pageIndex; i < Math.min(this.pages.length, pageIndex + 5); i++) {
      const entry = this.pages[i].sourceRef;
      if (!this.extractedEntries.has(entry)) {
        batch.push(entry);
      }
    }
    if (batch.length > 0) {
      await this.extractBatch(batch);
    }

    const safeFileName = this.safeNameByEntry.get(page.sourceRef);
    if (!safeFileName) {
      throw new Error(`Missing mapped filename for ${page.sourceRef}`);
    }

    const extractedPath = path.join(this.tempDir, safeFileName);
    const data = await fs.readFile(extractedPath);
    const payload: PagePayload = {
      data,
      mimeType: page.mimeType ?? getMimeType(page.sourceRef),
    };
    this.cache.set(cacheKey, payload);
    return payload;
  }

  async getCoverImage(): Promise<PagePayload | null> {
    if (this.pages.length === 0 || !this.tempDir) return null;

    const first = this.pages[0];
    await this.extractBatch([first.sourceRef]);
    const safeFileName = this.safeNameByEntry.get(first.sourceRef);
    if (!safeFileName) return null;

    const data = await fs.readFile(path.join(this.tempDir, safeFileName));
    return {
      data,
      mimeType: first.mimeType ?? getMimeType(first.sourceRef),
    };
  }

  async close(): Promise<void> {
    this.cache.clear();
    this.extractedEntries.clear();
    this.safeNameByEntry.clear();
    this.extractor = null;
    if (this.tempDir) {
      const dir = this.tempDir;
      this.tempDir = null;
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

import StreamZip from 'node-stream-zip';
import type { BookMetadata, PageDescriptor } from '@shared/types';
import {
  cleanDisplayTitle,
  getMimeType,
  isSupportedImagePath,
  naturalCompare,
  parseComicInfoXml,
} from './detectFormat';
import { LruPageCache, type BookAdapter, type OpenedAdapterResult, type PagePayload } from './types';

export class CbzAdapter implements BookAdapter {
  readonly format = 'cbz' as const;
  private zip: InstanceType<typeof StreamZip.async> | null = null;
  private pages: PageDescriptor[] = [];
  private readonly cache = new LruPageCache();

  constructor(private readonly filePath: string) {}

  async open(): Promise<OpenedAdapterResult> {
    this.zip = new StreamZip.async({ file: this.filePath });
    const entries = await this.zip.entries();

    const imageNames: string[] = [];
    let comicInfoEntryName: string | null = null;

    for (const entry of Object.values(entries)) {
      if (entry.isDirectory) continue;
      if (entry.name.toLowerCase().endsWith('comicinfo.xml')) {
        comicInfoEntryName = entry.name;
      }
      if (isSupportedImagePath(entry.name)) {
        imageNames.push(entry.name);
      }
    }

    imageNames.sort(naturalCompare);

    const metadata: BookMetadata = {
      title: cleanDisplayTitle(this.filePath),
    };

    if (comicInfoEntryName) {
      try {
        const xmlBuf = await this.zip.entryData(comicInfoEntryName);
        const parsed = parseComicInfoXml(xmlBuf.toString('utf8'));
        Object.assign(metadata, parsed);
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
  }

  async getPagePayload(pageIndex: number): Promise<PagePayload> {
    if (!this.zip) {
      throw new Error('CBZ archive is not open');
    }
    const page = this.pages[pageIndex];
    if (!page) {
      throw new Error(`Page index out of bounds: ${pageIndex}`);
    }

    const cacheKey = `p:${pageIndex}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const data = await this.zip.entryData(page.sourceRef);
    const payload: PagePayload = {
      data,
      mimeType: page.mimeType ?? getMimeType(page.sourceRef),
    };
    this.cache.set(cacheKey, payload);
    return payload;
  }

  async getCoverImage(): Promise<PagePayload | null> {
    if (this.pages.length === 0) return null;
    return this.getPagePayload(0);
  }

  async close(): Promise<void> {
    this.cache.clear();
    if (this.zip) {
      try {
        await this.zip.close();
      } finally {
        this.zip = null;
      }
    }
  }
}

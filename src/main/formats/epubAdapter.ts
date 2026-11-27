import path from 'node:path';
import StreamZip from 'node-stream-zip';
import { XMLParser } from 'fast-xml-parser';
import type { BookMetadata, PageDescriptor } from '@shared/types';
import {
  cleanDisplayTitle,
  getMimeType,
  isSupportedImagePath,
  naturalCompare,
} from './detectFormat';
import { LruPageCache, type BookAdapter, type OpenedAdapterResult, type PagePayload } from './types';

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
});

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeZipPath(zipPath: string): string {
  const cleaned = zipPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return path.posix.normalize(cleaned);
}

function resolveRelativeZipPath(baseFilePath: string, relativeHref: string): string {
  const stripped = relativeHref.split('#')[0].split('?')[0];
  let decoded = stripped;
  try {
    decoded = decodeURIComponent(stripped);
  } catch {
    // Keep original if malformed URI component
  }
  const baseDir = path.posix.dirname(normalizeZipPath(baseFilePath));
  if (baseDir === '.' || baseDir === '') {
    return normalizeZipPath(decoded);
  }
  return normalizeZipPath(path.posix.join(baseDir, decoded));
}

/**
 * Inspects an EPUB spine XHTML document.
 * If it is a manga/fixed-layout wrapper around a single image (via <img> or <svg><image>),
 * returns the relative href of that image; otherwise returns null so the reader falls back to XHTML rendering.
 */
export function extractSingleImageFromXhtml(xhtmlText: string): string | null {
  const imgSources: string[] = [];

  const imgRegex = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(xhtmlText)) !== null) {
    if (match[1]) imgSources.push(match[1]);
  }

  const svgImageRegex =
    /<image\b[^>]*\b(?:xlink:href|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = svgImageRegex.exec(xhtmlText)) !== null) {
    if (match[1]) imgSources.push(match[1]);
  }

  if (imgSources.length !== 1) {
    return null;
  }

  // Strip head, style, script, and tags to measure visible body text
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xhtmlText);
  const bodyContent = bodyMatch ? bodyMatch[1] : xhtmlText;
  const visibleText = bodyContent
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Pure image page (or image + tiny page number caption)
  if (visibleText.length <= 30) {
    return imgSources[0];
  }
  return null;
}

export class EpubAdapter implements BookAdapter {
  readonly format = 'epub' as const;
  private zip: InstanceType<typeof StreamZip.async> | null = null;
  private entryMap = new Map<string, string>();
  private pages: PageDescriptor[] = [];
  private coverPath: string | null = null;
  private readonly cache = new LruPageCache();

  constructor(private readonly filePath: string) {}

  private findEntryName(candidatePath: string): string | null {
    const norm = normalizeZipPath(candidatePath);
    if (this.entryMap.has(norm)) return this.entryMap.get(norm)!;
    const lower = norm.toLowerCase();
    for (const [k, v] of this.entryMap.entries()) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  }

  async open(): Promise<OpenedAdapterResult> {
    this.zip = new StreamZip.async({ file: this.filePath });
    const entries = await this.zip.entries();
    this.entryMap.clear();

    for (const entry of Object.values(entries)) {
      if (!entry.isDirectory) {
        this.entryMap.set(normalizeZipPath(entry.name), entry.name);
      }
    }

    const metadata: BookMetadata = {
      title: cleanDisplayTitle(this.filePath),
    };

    // 1. Locate OPF from META-INF/container.xml
    const containerKey = this.findEntryName('META-INF/container.xml');
    let opfPath: string | null = null;

    if (containerKey) {
      const containerXml = (await this.zip.entryData(containerKey)).toString('utf8');
      const container = xmlParser.parse(containerXml);
      const rootfiles = toArray(container?.container?.rootfiles?.rootfile);
      const firstRoot = rootfiles[0];
      if (firstRoot?.['@_full-path']) {
        opfPath = normalizeZipPath(String(firstRoot['@_full-path']));
      }
    }

    // Fallback: search for any .opf file
    if (!opfPath) {
      for (const normPath of this.entryMap.keys()) {
        if (normPath.toLowerCase().endsWith('.opf')) {
          opfPath = normPath;
          break;
        }
      }
    }

    if (opfPath) {
      const opfEntry = this.findEntryName(opfPath);
      if (opfEntry) {
        const opfXml = (await this.zip.entryData(opfEntry)).toString('utf8');
        await this.parseOpf(opfPath, opfXml, metadata);
      }
    }

    // Ultimate fallback if OPF yielded no spine items: treat all images in archive in natural order
    if (this.pages.length === 0) {
      const imagePaths = Array.from(this.entryMap.keys())
        .filter(isSupportedImagePath)
        .sort(naturalCompare);
      this.pages = imagePaths.map((p, index) => ({
        index,
        kind: 'image',
        sourceRef: p,
        mimeType: getMimeType(p),
      }));
      if (imagePaths.length > 0 && !this.coverPath) {
        this.coverPath = imagePaths[0];
      }
    }

    return { metadata, pages: this.pages };
  }

  private async parseOpf(
    opfPath: string,
    opfXml: string,
    metadata: BookMetadata,
  ): Promise<void> {
    const parsed = xmlParser.parse(opfXml);
    const pkg = parsed?.package;
    if (!pkg) return;

    // Metadata
    const meta = pkg.metadata;
    if (meta) {
      const titleNode = toArray(meta.title)[0];
      const titleText =
        typeof titleNode === 'string'
          ? titleNode
          : typeof titleNode?.['#text'] === 'string'
            ? titleNode['#text']
            : null;
      if (titleText && titleText.trim()) {
        metadata.title = titleText.trim();
      }

      const creatorNode = toArray(meta.creator)[0];
      const creatorText =
        typeof creatorNode === 'string'
          ? creatorNode
          : typeof creatorNode?.['#text'] === 'string'
            ? creatorNode['#text']
            : null;
      if (creatorText && creatorText.trim()) {
        metadata.author = creatorText.trim();
      }
    }

    // Manifest
    const manifestById = new Map<string, ManifestItem>();
    const items = toArray(pkg.manifest?.item);
    let coverIdFromMeta: string | null = null;

    for (const m of toArray(meta?.meta)) {
      if (m?.['@_name'] === 'cover' && m?.['@_content']) {
        coverIdFromMeta = String(m['@_content']);
      }
    }

    for (const item of items) {
      const id = String(item?.['@_id'] ?? '');
      const href = String(item?.['@_href'] ?? '');
      const mediaType = String(item?.['@_media-type'] ?? '');
      const properties = item?.['@_properties'] ? String(item['@_properties']) : undefined;
      if (!id || !href) continue;

      const resolvedHref = resolveRelativeZipPath(opfPath, href);
      manifestById.set(id, { id, href: resolvedHref, mediaType, properties });

      if (properties?.split(/\s+/).includes('cover-image')) {
        this.coverPath = resolvedHref;
      }
    }

    if (!this.coverPath && coverIdFromMeta) {
      const coverItem = manifestById.get(coverIdFromMeta);
      if (coverItem && coverItem.mediaType.startsWith('image/')) {
        this.coverPath = coverItem.href;
      }
    }

    // Spine
    const spine = pkg.spine;
    const progression = String(spine?.['@_page-progression-direction'] ?? '').toLowerCase();
    if (progression === 'rtl') {
      metadata.defaultDirection = 'rtl';
    } else if (progression === 'ltr') {
      metadata.defaultDirection = 'ltr';
    }

    const itemrefs = toArray(spine?.itemref);
    const descriptors: PageDescriptor[] = [];

    for (const ref of itemrefs) {
      const idref = String(ref?.['@_idref'] ?? '');
      const linear = String(ref?.['@_linear'] ?? 'yes').toLowerCase();
      if (!idref || linear === 'no') continue;

      const item = manifestById.get(idref);
      if (!item) continue;

      const entryName = this.findEntryName(item.href);
      if (!entryName || !this.zip) continue;

      // Direct image item in spine
      if (item.mediaType.startsWith('image/') || isSupportedImagePath(item.href)) {
        descriptors.push({
          index: descriptors.length,
          kind: 'image',
          sourceRef: item.href,
          mimeType: item.mediaType || getMimeType(item.href),
        });
        if (!this.coverPath) this.coverPath = item.href;
        continue;
      }

      // XHTML / HTML spine document -> inspect for single-image manga wrapper
      if (
        item.mediaType.includes('xhtml') ||
        item.mediaType.includes('html') ||
        /\.(xhtml|html|htm)$/i.test(item.href)
      ) {
        const raw = (await this.zip.entryData(entryName)).toString('utf8');
        const singleImgHref = extractSingleImageFromXhtml(raw);

        if (singleImgHref) {
          const resolvedImg = resolveRelativeZipPath(item.href, singleImgHref);
          if (this.findEntryName(resolvedImg)) {
            descriptors.push({
              index: descriptors.length,
              kind: 'image',
              sourceRef: resolvedImg,
              mimeType: getMimeType(resolvedImg),
            });
            if (!this.coverPath) this.coverPath = resolvedImg;
            continue;
          }
        }

        // Fallback: serve as XHTML page in sandboxed iframe
        descriptors.push({
          index: descriptors.length,
          kind: 'xhtml',
          sourceRef: item.href,
          mimeType: item.mediaType || 'application/xhtml+xml; charset=utf-8',
        });
      }
    }

    this.pages = descriptors;
  }

  async getPagePayload(pageIndex: number): Promise<PagePayload> {
    const page = this.pages[pageIndex];
    if (!page) {
      throw new Error(`EPUB page index out of bounds: ${pageIndex}`);
    }
    const payload = await this.getAsset(page.sourceRef);
    if (!payload) {
      throw new Error(`EPUB asset not found: ${page.sourceRef}`);
    }
    return payload;
  }

  async getAsset(relativePath: string): Promise<PagePayload | null> {
    if (!this.zip) return null;
    const norm = normalizeZipPath(relativePath);
    const cacheKey = `a:${norm}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const entryName = this.findEntryName(norm);
    if (!entryName) return null;

    const data = await this.zip.entryData(entryName);
    const payload: PagePayload = {
      data,
      mimeType: getMimeType(norm),
    };
    this.cache.set(cacheKey, payload);
    return payload;
  }

  async getCoverImage(): Promise<PagePayload | null> {
    if (this.coverPath) {
      const cover = await this.getAsset(this.coverPath);
      if (cover) return cover;
    }
    const firstImgPage = this.pages.find((p) => p.kind === 'image');
    if (firstImgPage) {
      return this.getAsset(firstImgPage.sourceRef);
    }
    return null;
  }

  async close(): Promise<void> {
    this.cache.clear();
    this.entryMap.clear();
    if (this.zip) {
      try {
        await this.zip.close();
      } finally {
        this.zip = null;
      }
    }
  }
}

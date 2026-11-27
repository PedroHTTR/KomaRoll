import fs from 'node:fs/promises';
import type { BookMetadata } from '@shared/types';
import { cleanDisplayTitle } from './detectFormat';
import type { BookAdapter, OpenedAdapterResult, PagePayload } from './types';

/**
 * PDF adapter delegates page count discovery and high-DPI canvas rendering to PDF.js
 * in the Renderer process while the Main process streams the raw PDF file over
 * the custom `manga-page://file/<bookId>` protocol with HTTP Range support.
 */
export class PdfAdapter implements BookAdapter {
  readonly format = 'pdf' as const;

  constructor(private readonly filePath: string) {}

  async open(): Promise<OpenedAdapterResult> {
    await fs.access(this.filePath);
    const metadata: BookMetadata = {
      title: cleanDisplayTitle(this.filePath),
    };
    return {
      metadata,
      pages: [],
      pdfFilePath: this.filePath,
    };
  }

  async getPagePayload(): Promise<PagePayload> {
    throw new Error('PDF pages are rendered directly in the renderer via PDF.js');
  }

  async getCoverImage(): Promise<PagePayload | null> {
    // PDF thumbnails are generated lazily by the renderer via PDF.js canvas and saved via IPC
    return null;
  }

  async close(): Promise<void> {
    // No persistent file handles held by PdfAdapter
  }
}

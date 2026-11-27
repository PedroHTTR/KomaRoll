import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type { PDFDocumentProxy };

export async function loadPdfDocument(url: string): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjsLib.getDocument({
    url,
    rangeChunkSize: 65536 * 4,
    disableAutoFetch: false,
    disableStream: false,
  });
  return loadingTask.promise;
}

/**
 * Generates a compact WebP/JPEG thumbnail of page 1 of a PDF for the library grid.
 */
export async function generatePdfCoverThumbnail(
  pdfUrl: string,
  maxWidth = 380,
): Promise<{ pageCount: number; bytes: Uint8Array } | null> {
  let doc: PDFDocumentProxy | null = null;
  try {
    doc = await loadPdfDocument(pdfUrl);
    const pageCount = doc.numPages;
    if (pageCount <= 0) return null;

    const page = await doc.getPage(1);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = Math.min(1.5, maxWidth / Math.max(1, baseVp.width));
    const vp = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (b) => {
          if (b) {
            resolve(b);
          } else {
            canvas.toBlob(resolve, 'image/jpeg', 0.85);
          }
        },
        'image/webp',
        0.84,
      );
    });

    if (!blob) return null;
    const arrayBuf = await blob.arrayBuffer();
    return { pageCount, bytes: new Uint8Array(arrayBuf) };
  } catch (err) {
    console.warn('[pdfClient] Failed to generate PDF cover thumbnail:', err);
    return null;
  } finally {
    if (doc) {
      await doc.destroy().catch(() => {});
    }
  }
}

import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

interface PdfPageSlotProps {
  pdfDoc: PDFDocumentProxy;
  pageIndex: number;
  width: number;
  height: number;
  onDimensions: (pageIndex: number, naturalWidth: number, naturalHeight: number) => void;
}

export const PdfPageSlot: React.FC<PdfPageSlotProps> = React.memo(
  ({ pdfDoc, pageIndex, width, height, onDimensions }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [rendering, setRendering] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      let renderTask: RenderTask | null = null;

      const renderPage = async () => {
        setRendering(true);
        setError(null);
        try {
          const page = await pdfDoc.getPage(pageIndex + 1);
          if (cancelled) return;

          const baseViewport = page.getViewport({ scale: 1 });
          onDimensions(pageIndex, baseViewport.width, baseViewport.height);

          const canvas = canvasRef.current;
          if (!canvas || cancelled) return;

          const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
          const scaleX = width / Math.max(1, baseViewport.width);
          const scaleY = height / Math.max(1, baseViewport.height);
          const cssScale = Math.min(scaleX, scaleY);
          // Cap backing pixel area so ultra-zoomed pages stay fast
          const renderScale = Math.min(4.0, Math.max(0.5, cssScale * dpr));
          const viewport = page.getViewport({ scale: renderScale });

          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));

          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) return;

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          renderTask = page.render({
            canvasContext: ctx,
            viewport,
          });

          await renderTask.promise;
          if (!cancelled) {
            setRendering(false);
          }
        } catch (err) {
          if (cancelled) return;
          const name = err instanceof Error ? err.name : '';
          if (name === 'RenderingCancelledException') return;
          setError(err instanceof Error ? err.message : 'PDF render failed');
          setRendering(false);
        }
      };

      void renderPage();

      return () => {
        cancelled = true;
        if (renderTask) {
          renderTask.cancel();
        }
      };
    }, [pdfDoc, pageIndex, width, height, onDimensions]);

    // Explicitly release backing GPU texture memory on unmount
    useEffect(() => {
      return () => {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      };
    }, []);

    return (
      <div
        className="relative flex items-center justify-center overflow-hidden bg-zinc-950/40 select-none"
        style={{ width, height }}
      >
        {rendering && (
          <div className="page-skeleton pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-medium tracking-wider text-zinc-500">
              {pageIndex + 1}
            </span>
          </div>
        )}
        {error ? (
          <div className="p-4 text-center text-xs text-rose-400">
            Page {pageIndex + 1}: {error}
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="h-full w-full object-contain select-none"
            style={{ width, height }}
          />
        )}
      </div>
    );
  },
);

PdfPageSlot.displayName = 'PdfPageSlot';

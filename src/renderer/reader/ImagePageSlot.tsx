import React, { useState } from 'react';
import { RefreshCw, ImageOff } from 'lucide-react';

interface ImagePageSlotProps {
  bookId: string;
  pageIndex: number;
  width: number;
  height: number;
  onDimensions: (pageIndex: number, naturalWidth: number, naturalHeight: number) => void;
}

export const ImagePageSlot: React.FC<ImagePageSlotProps> = React.memo(
  ({ bookId, pageIndex, width, height, onDimensions }) => {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);
    const [retryKey, setRetryKey] = useState(0);

    const src = `manga-page://book/${encodeURIComponent(bookId)}/page/${pageIndex}${
      retryKey > 0 ? `?r=${retryKey}` : ''
    }`;

    return (
      <div
        className="relative flex items-center justify-center overflow-hidden bg-zinc-950/40 select-none"
        style={{ width, height }}
      >
        {!loaded && !error && (
          <div className="page-skeleton absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-medium tracking-wider text-zinc-500">
              {pageIndex + 1}
            </span>
          </div>
        )}

        {error ? (
          <div className="flex flex-col items-center justify-center gap-3 p-6 text-center text-zinc-400">
            <ImageOff className="h-8 w-8 text-zinc-500" />
            <p className="text-xs">Could not load page {pageIndex + 1}</p>
            <button
              type="button"
              onClick={() => {
                setError(false);
                setLoaded(false);
                setRetryKey((k) => k + 1);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        ) : (
          <img
            src={src}
            alt={`Page ${pageIndex + 1}`}
            draggable={false}
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget;
              setLoaded(true);
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                onDimensions(pageIndex, img.naturalWidth, img.naturalHeight);
              }
            }}
            onError={() => {
              setError(true);
            }}
            className={`h-full w-full object-contain transition-opacity duration-150 select-none ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
      </div>
    );
  },
);

ImagePageSlot.displayName = 'ImagePageSlot';

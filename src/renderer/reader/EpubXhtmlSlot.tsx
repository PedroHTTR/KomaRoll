import React, { useEffect } from 'react';

interface EpubXhtmlSlotProps {
  bookId: string;
  pageIndex: number;
  sourceRef: string;
  width: number;
  height: number;
  isDragging: boolean;
  onDimensions: (pageIndex: number, naturalWidth: number, naturalHeight: number) => void;
}

export const EpubXhtmlSlot: React.FC<EpubXhtmlSlotProps> = React.memo(
  ({ bookId, pageIndex, sourceRef, width, height, isDragging, onDimensions }) => {
    const encodedPath = sourceRef
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const src = `manga-page://book/${encodeURIComponent(bookId)}/epub-asset/${encodedPath}`;

    // Give XHTML text/mixed pages a comfortable standard book aspect ratio (~0.72)
    useEffect(() => {
      onDimensions(pageIndex, 720, 1000);
    }, [pageIndex, onDimensions]);

    return (
      <div
        className="relative flex flex-col overflow-hidden rounded-sm bg-[#f7f5f0] shadow-lg select-none"
        style={{ width, height }}
      >
        <div className="flex items-center justify-between border-b border-zinc-300/80 bg-zinc-200/80 px-3 py-1 text-[10px] font-medium tracking-wide text-zinc-600 uppercase">
          <span>EPUB Page {pageIndex + 1}</span>
          <span>XHTML</span>
        </div>
        <div className="relative flex-1 overflow-hidden">
          <iframe
            title={`EPUB Page ${pageIndex + 1}`}
            src={src}
            sandbox="allow-same-origin"
            className="h-full w-full border-0 bg-[#f7f5f0]"
          />
          {/* Prevent iframe from swallowing pointer events while user drags the horizontal strip */}
          {isDragging && <div className="absolute inset-0 z-10 cursor-grabbing" />}
        </div>
      </div>
    );
  },
);

EpubXhtmlSlot.displayName = 'EpubXhtmlSlot';

import React, { useState } from 'react';
import { BookOpen, Bookmark, Trash2 } from 'lucide-react';
import type { LibraryBook } from '@shared/types';

interface BookCardProps {
  book: LibraryBook;
  onOpen: (filePath: string) => void;
  onRemove: (bookId: string) => void;
}

const FORMAT_COLORS: Record<LibraryBook['format'], string> = {
  cbz: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  cbr: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  epub: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  pdf: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

export const BookCard: React.FC<BookCardProps> = React.memo(({ book, onOpen, onRemove }) => {
  const [imgFailed, setImgFailed] = useState(false);

  const progressPct = book.progress ? Math.round(book.progress.ratio * 100) : 0;
  const isCompleted = progressPct >= 99;
  const thumbSrc =
    book.thumbnailReady && !imgFailed
      ? `manga-page://thumb/${encodeURIComponent(book.id)}?v=${Math.floor(book.modifiedAt)}`
      : null;

  return (
    <div
      onClick={() => onOpen(book.filePath)}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '200px 340px' }}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-white/8 bg-zinc-900/70 transition duration-200 hover:-translate-y-0.5 hover:border-rose-500/40 hover:bg-zinc-900 hover:shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
    >
      {/* Cover Frame (Manga 2:3 ratio) */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-zinc-950">
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt={book.title}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 p-4 text-center">
            <BookOpen className="h-9 w-9 text-zinc-700" />
            <span className="line-clamp-3 text-xs font-medium text-zinc-500">
              {book.title}
            </span>
          </div>
        )}

        {/* Top badges */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase backdrop-blur-md ${FORMAT_COLORS[book.format]}`}
          >
            {book.format}
          </span>
          {book.bookmarks.length > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded border border-amber-400/30 bg-zinc-950/75 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 backdrop-blur-md">
              <Bookmark className="h-2.5 w-2.5 fill-amber-400" />
              {book.bookmarks.length}
            </span>
          )}
        </div>

        {/* Delete/Remove hover button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(book.id);
          }}
          title="Remove from Library"
          className="absolute top-2 right-2 rounded-lg bg-zinc-950/75 p-1.5 text-zinc-400 opacity-0 backdrop-blur-md transition group-hover:opacity-100 hover:bg-rose-500/80 hover:text-white"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>

        {/* Bottom Progress Overlay */}
        {book.progress && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-2.5 pt-6 pb-2">
            <div className="mb-1 flex items-center justify-between text-[10px] font-medium text-zinc-200">
              <span>
                {isCompleted
                  ? 'Completed'
                  : `p. ${book.progress.pageIndex + 1} / ${book.progress.pageCount}`}
              </span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className={`h-full rounded-full ${
                  isCompleted ? 'bg-emerald-400' : 'bg-rose-500'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Metadata footer */}
      <div className="flex flex-1 flex-col justify-between gap-1 p-2.5">
        <h3
          className="line-clamp-2 text-xs leading-snug font-semibold text-zinc-100 group-hover:text-white"
          title={book.title}
        >
          {book.title}
        </h3>
        <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
          <span className="truncate">{book.series}</span>
          {book.pageCount != null && book.pageCount > 0 && (
            <span className="shrink-0 font-mono text-[10px]">{book.pageCount}p</span>
          )}
        </div>
      </div>
    </div>
  );
});

BookCard.displayName = 'BookCard';

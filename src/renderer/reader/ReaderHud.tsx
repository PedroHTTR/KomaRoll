import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Columns2,
  GalleryHorizontalEnd,
  Maximize2,
  Minus,
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import type {
  BookFormat,
  Bookmark as BookmarkType,
  FitMode,
  ReaderBackground,
  ReaderSettings,
} from '@shared/types';

interface ReaderHudProps {
  visible: boolean;
  title: string;
  format: BookFormat;
  currentPage: number;
  pageCount: number;
  settings: ReaderSettings;
  bookmarks: BookmarkType[];
  onBack: () => void;
  onJumpToPage: (pageIndex: number, behavior?: 'auto' | 'smooth') => void;
  onUpdateSettings: (partial: Partial<ReaderSettings>) => void;
  onAddBookmark: (pageIndex: number, label?: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onToggleFullscreen: () => void;
  onHoverHud: (hovering: boolean) => void;
}

const BG_SWATCHES: { value: ReaderBackground; label: string }[] = [
  { value: '#0d0e12', label: 'Obsidian' },
  { value: '#16181f', label: 'Slate' },
  { value: '#000000', label: 'AMOLED Black' },
  { value: '#f4f1ea', label: 'Paper' },
];

const FIT_MODES: { value: FitMode; label: string }[] = [
  { value: 'height', label: 'Fit Height' },
  { value: 'screen', label: 'Fit Screen' },
  { value: 'original', label: 'Original' },
];

export const ReaderHud: React.FC<ReaderHudProps> = ({
  visible,
  title,
  format,
  currentPage,
  pageCount,
  settings,
  bookmarks,
  onBack,
  onJumpToPage,
  onUpdateSettings,
  onAddBookmark,
  onRemoveBookmark,
  onToggleFullscreen,
  onHoverHud,
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [editingPage, setEditingPage] = useState(false);
  const [pageInput, setPageInput] = useState('');
  const [bookmarkLabel, setBookmarkLabel] = useState('');

  const activeBookmark = bookmarks.find((b) => b.pageIndex === currentPage);
  const progressPct = pageCount > 1 ? (currentPage / (pageCount - 1)) * 100 : 100;
  const isRtl = settings.direction === 'rtl';

  const forceVisible = visible || settingsOpen || bookmarksOpen || editingPage;

  const handleScrubClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (pageCount <= 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const readingRatio = isRtl ? 1 - clickRatio : clickRatio;
    const targetPage = Math.round(readingRatio * (pageCount - 1));
    onJumpToPage(targetPage, 'auto');
  };

  const handleToggleCurrentBookmark = () => {
    if (activeBookmark) {
      onRemoveBookmark(activeBookmark.id);
    } else {
      onAddBookmark(currentPage, `Page ${currentPage + 1}`);
    }
  };

  const handlePageJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isFinite(parsed)) {
      const clamped = Math.max(1, Math.min(pageCount, parsed)) - 1;
      onJumpToPage(clamped, 'auto');
    }
    setEditingPage(false);
  };

  const cycleFitMode = () => {
    const idx = FIT_MODES.findIndex((m) => m.value === settings.fitMode);
    const next = FIT_MODES[(idx + 1) % FIT_MODES.length];
    onUpdateSettings({ fitMode: next.value, zoom: 1 });
  };

  return (
    <>
      {/* TOP HUD BAR */}
      <header
        onMouseEnter={() => onHoverHud(true)}
        onMouseLeave={() => onHoverHud(false)}
        className={`fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-4 border-b border-white/10 bg-zinc-950/85 px-4 py-2.5 backdrop-blur-md transition-all duration-200 ${
          forceVisible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-full opacity-0'
        }`}
      >
        {/* Left: Back + Title */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/12"
            title="Back to Library (Esc)"
          >
            <ArrowLeft className="h-4 w-4" />
            Library
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold text-zinc-100">{title}</h1>
              <span className="shrink-0 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-rose-300 uppercase">
                {format}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Reader Controls */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Direction RTL/LTR */}
          <button
            type="button"
            onClick={() =>
              onUpdateSettings({ direction: isRtl ? 'ltr' : 'rtl' })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/12"
            title="Toggle Reading Direction (R)"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-rose-400" />
            <span>{isRtl ? 'RTL ←' : 'LTR →'}</span>
          </button>

          {/* Continuous Strip vs Page Snap */}
          <button
            type="button"
            onClick={() =>
              onUpdateSettings({
                scrollMode: settings.scrollMode === 'continuous' ? 'snap' : 'continuous',
              })
            }
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              settings.scrollMode === 'continuous'
                ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/12'
            }`}
            title="Toggle Continuous Sidescroll / Page Snap (M)"
          >
            {settings.scrollMode === 'continuous' ? (
              <>
                <GalleryHorizontalEnd className="h-3.5 w-3.5" />
                <span>Strip</span>
              </>
            ) : (
              <>
                <Columns2 className="h-3.5 w-3.5" />
                <span>Snap</span>
              </>
            )}
          </button>

          {/* Fit Mode */}
          <button
            type="button"
            onClick={cycleFitMode}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/12"
            title="Cycle Fit Mode (0 resets zoom)"
          >
            {FIT_MODES.find((m) => m.value === settings.fitMode)?.label ?? 'Custom'}
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center rounded-lg border border-white/10 bg-white/5">
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ zoom: Math.max(0.5, Number((settings.zoom - 0.15).toFixed(2))) })
              }
              className="p-1.5 text-zinc-300 transition hover:text-white"
              title="Zoom Out (-)"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ zoom: 1, fitMode: 'height' })}
              className="min-w-[44px] px-1 text-center text-xs font-medium text-zinc-200 hover:text-white"
              title="Reset Zoom (0)"
            >
              {Math.round(settings.zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ zoom: Math.min(3, Number((settings.zoom + 0.15).toFixed(2))) })
              }
              className="p-1.5 text-zinc-300 transition hover:text-white"
              title="Zoom In (+)"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Toggle Bookmark on Current Page */}
          <button
            type="button"
            onClick={handleToggleCurrentBookmark}
            className={`rounded-lg border p-1.5 transition ${
              activeBookmark
                ? 'border-amber-400/40 bg-amber-500/20 text-amber-300'
                : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/12 hover:text-white'
            }`}
            title={activeBookmark ? 'Remove Bookmark (B)' : 'Bookmark Current Page (B)'}
          >
            {activeBookmark ? (
              <BookmarkCheck className="h-4 w-4" />
            ) : (
              <Bookmark className="h-4 w-4" />
            )}
          </button>

          {/* Bookmarks Drawer Button */}
          <button
            type="button"
            onClick={() => {
              setBookmarksOpen((v) => !v);
              setSettingsOpen(false);
            }}
            className={`relative rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
              bookmarksOpen
                ? 'border-rose-500/40 bg-rose-500/20 text-rose-200'
                : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/12 hover:text-white'
            }`}
            title="View Bookmarks"
          >
            Bookmarks
            {bookmarks.length > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500/25 px-1.5 py-0.2 text-[10px] text-amber-300">
                {bookmarks.length}
              </span>
            )}
          </button>

          {/* Settings Popover Trigger */}
          <button
            type="button"
            onClick={() => {
              setSettingsOpen((v) => !v);
              setBookmarksOpen(false);
            }}
            className={`rounded-lg border p-1.5 transition ${
              settingsOpen
                ? 'border-rose-500/40 bg-rose-500/20 text-rose-200'
                : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/12 hover:text-white'
            }`}
            title="Reader Settings"
          >
            <Settings2 className="h-4 w-4" />
          </button>

          {/* Fullscreen */}
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-zinc-300 transition hover:bg-white/12 hover:text-white"
            title="Toggle Fullscreen (F)"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* SETTINGS POPOVER */}
      {settingsOpen && (
        <aside
          onMouseEnter={() => onHoverHud(true)}
          onMouseLeave={() => onHoverHud(false)}
          className="fixed top-14 right-4 z-40 w-80 rounded-xl border border-white/12 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-lg"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wider text-zinc-300 uppercase">
              Sidescroller Settings
            </h2>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 text-xs">
            {/* Page Gap */}
            <div>
              <div className="mb-1.5 flex justify-between text-zinc-300">
                <span>Page Gap</span>
                <span className="font-mono text-zinc-400">{settings.pageGap}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={32}
                step={2}
                value={settings.pageGap}
                onChange={(e) => onUpdateSettings({ pageGap: Number(e.target.value) })}
                className="w-full accent-rose-500"
              />
            </div>

            {/* Wheel Scroll Speed */}
            <div>
              <div className="mb-1.5 flex justify-between text-zinc-300">
                <span>Wheel Scroll Speed</span>
                <span className="font-mono text-zinc-400">
                  {settings.wheelScrollSpeed.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.05}
                value={settings.wheelScrollSpeed}
                onChange={(e) =>
                  onUpdateSettings({ wheelScrollSpeed: Number(e.target.value) })
                }
                className="w-full accent-rose-500"
              />
            </div>

            {/* Invert RTL Wheel */}
            <label className="flex cursor-pointer items-center justify-between gap-2 text-zinc-300">
              <span>Invert wheel direction in RTL</span>
              <input
                type="checkbox"
                checked={settings.invertWheelInRtl}
                onChange={(e) => onUpdateSettings({ invertWheelInRtl: e.target.checked })}
                className="h-4 w-4 rounded accent-rose-500"
              />
            </label>

            {/* Background Swatches */}
            <div>
              <span className="mb-2 block text-zinc-300">Canvas Background</span>
              <div className="grid grid-cols-4 gap-2">
                {BG_SWATCHES.map((swatch) => (
                  <button
                    key={swatch.value}
                    type="button"
                    onClick={() => onUpdateSettings({ backgroundColor: swatch.value })}
                    className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[10px] transition ${
                      settings.backgroundColor === swatch.value
                        ? 'border-rose-500 bg-rose-500/15 text-rose-200'
                        : 'border-white/10 bg-white/5 text-zinc-400 hover:border-white/25'
                    }`}
                  >
                    <span
                      className="h-4 w-full rounded border border-white/15"
                      style={{ backgroundColor: swatch.value }}
                    />
                    <span className="truncate">{swatch.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Keyboard shortcuts cheat sheet */}
            <div className="rounded-lg border border-white/8 bg-white/4 p-2.5 text-[11px] text-zinc-400">
              <div className="mb-1 font-medium text-zinc-300">Shortcuts</div>
              <div className="grid grid-cols-2 gap-y-1">
                <span>← / → or A / D</span>
                <span className="text-right text-zinc-300">Scroll / Page</span>
                <span>Wheel / Drag</span>
                <span className="text-right text-zinc-300">Sidescroll</span>
                <span>Ctrl + Wheel</span>
                <span className="text-right text-zinc-300">Zoom</span>
                <span>R / M / B / F</span>
                <span className="text-right text-zinc-300">RTL / Mode / BM / FS</span>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* BOOKMARKS SLIDE-OVER DRAWER */}
      {bookmarksOpen && (
        <aside
          onMouseEnter={() => onHoverHud(true)}
          onMouseLeave={() => onHoverHud(false)}
          className="fixed top-14 right-4 bottom-20 z-40 flex w-80 flex-col rounded-xl border border-white/12 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-lg"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wider text-zinc-300 uppercase">
              Bookmarks ({bookmarks.length})
            </h2>
            <button
              type="button"
              onClick={() => setBookmarksOpen(false)}
              className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAddBookmark(currentPage, bookmarkLabel || `Page ${currentPage + 1}`);
              setBookmarkLabel('');
            }}
            className="mb-3 flex gap-1.5"
          >
            <input
              type="text"
              value={bookmarkLabel}
              onChange={(e) => setBookmarkLabel(e.target.value)}
              placeholder={`Bookmark Page ${currentPage + 1}...`}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-rose-500/60 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600"
            >
              Add
            </button>
          </form>

          <div className="manga-scroll flex-1 space-y-1.5 overflow-y-auto pr-1">
            {bookmarks.length === 0 ? (
              <p className="py-8 text-center text-xs text-zinc-500">
                No bookmarks yet. Press <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">B</kbd> on any page to save it.
              </p>
            ) : (
              bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className={`group flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 transition ${
                    bm.pageIndex === currentPage
                      ? 'border-amber-400/40 bg-amber-500/10'
                      : 'border-white/8 bg-white/4 hover:border-white/16 hover:bg-white/8'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onJumpToPage(bm.pageIndex, 'smooth')}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-xs font-medium text-zinc-100">
                      {bm.label}
                    </div>
                    <div className="text-[10px] text-zinc-400">Page {bm.pageIndex + 1}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveBookmark(bm.id)}
                    className="rounded p-1 text-zinc-500 opacity-60 transition hover:bg-rose-500/20 hover:text-rose-300 hover:opacity-100"
                    title="Delete bookmark"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {/* BOTTOM SCRUBBER HUD */}
      <footer
        onMouseEnter={() => onHoverHud(true)}
        onMouseLeave={() => onHoverHud(false)}
        className={`fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-zinc-950/85 px-5 py-3 backdrop-blur-md transition-all duration-200 ${
          forceVisible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-full opacity-0'
        }`}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          {/* Left button: Next in RTL, Prev in LTR */}
          <button
            type="button"
            onClick={() =>
              onJumpToPage(isRtl ? currentPage + 1 : currentPage - 1, 'smooth')
            }
            disabled={isRtl ? currentPage >= pageCount - 1 : currentPage <= 0}
            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-zinc-300 transition hover:bg-white/12 disabled:opacity-35"
            title={isRtl ? 'Next Page' : 'Previous Page'}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Direction-aware Scrubber Track */}
          <div className="flex flex-1 flex-col gap-1.5">
            <div
              onClick={handleScrubClick}
              className="group relative flex h-5 cursor-pointer items-center"
              title="Click to jump to page"
            >
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/12">
                <div
                  className="absolute top-0 bottom-0 rounded-full bg-gradient-to-r from-rose-500 to-pink-400 transition-all duration-100"
                  style={
                    isRtl
                      ? { right: 0, width: `${progressPct}%` }
                      : { left: 0, width: `${progressPct}%` }
                  }
                />
              </div>

              {/* Bookmark markers */}
              {pageCount > 1 &&
                bookmarks.map((bm) => {
                  const ratio = bm.pageIndex / (pageCount - 1);
                  const leftPct = (isRtl ? 1 - ratio : ratio) * 100;
                  return (
                    <button
                      key={bm.id}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onJumpToPage(bm.pageIndex, 'smooth');
                      }}
                      title={`${bm.label} (Page ${bm.pageIndex + 1})`}
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-950 bg-amber-400 shadow transition hover:scale-125"
                      style={{ left: `${leftPct}%` }}
                    />
                  );
                })}

              {/* Current Thumb */}
              <div
                className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-rose-500 shadow-lg transition-transform group-hover:scale-125"
                style={{ left: `${isRtl ? 100 - progressPct : progressPct}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>{isRtl ? `End (${pageCount})` : 'Start (1)'}</span>

              <div className="flex items-center gap-2">
                {editingPage ? (
                  <form onSubmit={handlePageJumpSubmit} className="inline-flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={pageCount}
                      autoFocus
                      value={pageInput}
                      onChange={(e) => setPageInput(e.target.value)}
                      onBlur={() => setEditingPage(false)}
                      className="w-16 rounded border border-rose-500/60 bg-zinc-900 px-1.5 py-0.5 text-center text-xs text-white focus:outline-none"
                    />
                    <span className="text-zinc-400">/ {pageCount}</span>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setPageInput(String(currentPage + 1));
                      setEditingPage(true);
                    }}
                    className="rounded px-2 py-0.5 font-mono text-xs font-medium text-zinc-100 hover:bg-white/10"
                    title="Click to jump to a specific page"
                  >
                    Page {pageCount > 0 ? currentPage + 1 : 0} / {pageCount}
                  </button>
                )}
                <span className="text-zinc-500">({Math.round(progressPct)}%)</span>
              </div>

              <span>{isRtl ? 'Start (1)' : `End (${pageCount})`}</span>
            </div>
          </div>

          {/* Right button: Prev in RTL, Next in LTR */}
          <button
            type="button"
            onClick={() =>
              onJumpToPage(isRtl ? currentPage - 1 : currentPage + 1, 'smooth')
            }
            disabled={isRtl ? currentPage <= 0 : currentPage >= pageCount - 1}
            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-zinc-300 transition hover:bg-white/12 disabled:opacity-35"
            title={isRtl ? 'Previous Page' : 'Next Page'}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </footer>
    </>
  );
};

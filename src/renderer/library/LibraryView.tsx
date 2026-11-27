import React, { useEffect, useMemo, useRef } from 'react';
import {
  Bookmark,
  BookOpen,
  Clock,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Layers,
  Library,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type { BookFormat, LibraryBook } from '@shared/types';
import { useAppStore, type SortOption, type StatusFilter } from '@renderer/store/useAppStore';
import { BookCard } from './BookCard';

const FORMAT_OPTIONS: ('all' | BookFormat)[] = ['all', 'cbz', 'cbr', 'epub', 'pdf'];

function getBookStatus(book: LibraryBook): 'unread' | 'reading' | 'completed' {
  if (!book.progress) return 'unread';
  if (book.progress.ratio >= 0.99) return 'completed';
  return 'reading';
}

export const LibraryView: React.FC = () => {
  const library = useAppStore((s) => s.library);
  const sidebarSection = useAppStore((s) => s.sidebarSection);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const formatFilter = useAppStore((s) => s.formatFilter);
  const statusFilter = useAppStore((s) => s.statusFilter);
  const sortBy = useAppStore((s) => s.sortBy);
  const groupBySeries = useAppStore((s) => s.groupBySeries);
  const selectedFolderFilter = useAppStore((s) => s.selectedFolderFilter);

  const openBook = useAppStore((s) => s.openBook);
  const openFileDialog = useAppStore((s) => s.openFileDialog);
  const addFolderDialog = useAppStore((s) => s.addFolderDialog);
  const removeFolder = useAppStore((s) => s.removeFolder);
  const rescanLibrary = useAppStore((s) => s.rescanLibrary);
  const removeBook = useAppStore((s) => s.removeBook);
  const setSidebarSection = useAppStore((s) => s.setSidebarSection);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const setFormatFilter = useAppStore((s) => s.setFormatFilter);
  const setStatusFilter = useAppStore((s) => s.setStatusFilter);
  const setSortBy = useAppStore((s) => s.setSortBy);
  const setGroupBySeries = useAppStore((s) => s.setGroupBySeries);
  const setSelectedFolderFilter = useAppStore((s) => s.setSelectedFolderFilter);

  // Lazy background PDF cover thumbnail generation in renderer
  const processedPdfIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const pendingPdfs = library.books.filter(
      (b) => b.format === 'pdf' && !b.thumbnailReady && !processedPdfIdsRef.current.has(b.id),
    );
    if (pendingPdfs.length === 0) return;

    const runQueue = async () => {
      // Lazy-load PDF.js chunk only when PDFs actually exist in the library
      const { generatePdfCoverThumbnail } = await import('@renderer/reader/pdfClient');
      for (const book of pendingPdfs) {
        if (cancelled) break;
        processedPdfIdsRef.current.add(book.id);
        const pdfUrl = `manga-page://file/${encodeURIComponent(book.id)}`;
        const result = await generatePdfCoverThumbnail(pdfUrl);
        if (result && !cancelled) {
          await window.mangaApi.savePdfThumbnail(book.id, result.pageCount, result.bytes);
        }
      }
    };

    void runQueue();
    return () => {
      cancelled = true;
    };
  }, [library.books]);

  const continueReading = useMemo(
    () =>
      library.books
        .filter((b) => b.lastReadAt !== null)
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
        .slice(0, 6),
    [library.books],
  );

  const filteredBooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const list = library.books.filter((book) => {
      if (sidebarSection === 'recent' && book.lastReadAt === null) return false;
      if (sidebarSection === 'bookmarked' && book.bookmarks.length === 0) return false;
      if (selectedFolderFilter && book.folderPath !== selectedFolderFilter) return false;
      if (formatFilter !== 'all' && book.format !== formatFilter) return false;
      if (statusFilter !== 'all' && getBookStatus(book) !== statusFilter) return false;
      if (q) {
        const hay = `${book.title} ${book.series} ${book.fileName} ${book.author ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (sortBy === 'added') {
        return b.addedAt - a.addedAt;
      }
      // recent
      if (a.lastReadAt && b.lastReadAt) return b.lastReadAt - a.lastReadAt;
      if (a.lastReadAt) return -1;
      if (b.lastReadAt) return 1;
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    });

    return list;
  }, [
    library.books,
    sidebarSection,
    selectedFolderFilter,
    formatFilter,
    statusFilter,
    searchQuery,
    sortBy,
  ]);

  const seriesGroups = useMemo(() => {
    if (!groupBySeries) return null;
    const map = new Map<string, LibraryBook[]>();
    for (const book of filteredBooks) {
      const key = book.series || 'Uncategorized';
      const arr = map.get(key) ?? [];
      arr.push(book);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );
  }, [filteredBooks, groupBySeries]);

  const showSpotlight =
    sidebarSection === 'all' &&
    !selectedFolderFilter &&
    !searchQuery.trim() &&
    formatFilter === 'all' &&
    statusFilter === 'all' &&
    continueReading.length > 0;

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#0d0e12] text-zinc-100">
      {/* LEFT SIDEBAR */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/8 bg-[#11131a]">
        {/* Brand Header */}
        <div className="flex items-center gap-2.5 border-b border-white/8 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 shadow-lg shadow-rose-500/20">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white">KomaRoll</div>
            <div className="text-[11px] text-zinc-400">Sidescroll Manga Reader</div>
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className="grid grid-cols-2 gap-2 p-3">
          <button
            type="button"
            onClick={() => void openFileDialog()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-600"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            Open File
          </button>
          <button
            type="button"
            onClick={() => void addFolderDialog()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-white/10"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Add Folder
          </button>
        </div>

        {/* Navigation */}
        <nav className="space-y-0.5 px-3 py-1">
          <button
            type="button"
            onClick={() => setSidebarSection('all')}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition ${
              sidebarSection === 'all' && !selectedFolderFilter
                ? 'bg-rose-500/15 text-rose-200'
                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Library className="h-4 w-4" />
              All Manga
            </span>
            <span className="font-mono text-[11px] opacity-70">{library.books.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setSidebarSection('recent')}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition ${
              sidebarSection === 'recent'
                ? 'bg-rose-500/15 text-rose-200'
                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Clock className="h-4 w-4" />
              Recent History
            </span>
            <span className="font-mono text-[11px] opacity-70">
              {library.books.filter((b) => b.lastReadAt !== null).length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSidebarSection('bookmarked')}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition ${
              sidebarSection === 'bookmarked'
                ? 'bg-rose-500/15 text-rose-200'
                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Bookmark className="h-4 w-4" />
              Bookmarked
            </span>
            <span className="font-mono text-[11px] opacity-70">
              {library.books.filter((b) => b.bookmarks.length > 0).length}
            </span>
          </button>
        </nav>

        {/* Watched Folders */}
        <div className="mt-4 flex flex-1 flex-col overflow-hidden border-t border-white/8 px-3 pt-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
              Folders
            </span>
            <button
              type="button"
              onClick={() => void rescanLibrary()}
              disabled={library.scanning}
              title="Rescan library folders"
              className="rounded p-1 text-zinc-400 transition hover:bg-white/8 hover:text-white disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${library.scanning ? 'animate-spin text-rose-400' : ''}`}
              />
            </button>
          </div>

          <div className="manga-scroll flex-1 space-y-1 overflow-y-auto pb-4">
            {library.folders.length === 0 ? (
              <p className="px-2 py-2 text-[11px] leading-relaxed text-zinc-500">
                No library folders added yet. Add a folder to automatically scan CBZ, CBR, EPUB,
                and PDF files.
              </p>
            ) : (
              library.folders.map((folder) => {
                const folderName = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
                const active = selectedFolderFilter === folder;
                return (
                  <div
                    key={folder}
                    className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition ${
                      active
                        ? 'bg-rose-500/15 text-rose-200'
                        : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedFolderFilter(active ? null : folder)
                      }
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      title={folder}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{folderName}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeFolder(folder)}
                      title="Remove folder from library"
                      className="rounded p-1 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/20 hover:text-rose-300"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Supported Formats Footer */}
        <div className="border-t border-white/8 px-4 py-2.5 text-[10px] text-zinc-500">
          Drop <span className="text-zinc-300">.cbz · .cbr · .epub · .pdf</span> anywhere to read
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Search & Filter Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 bg-[#0f1117] px-6 py-3.5">
          {/* Search */}
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, series, filename..."
              className="w-full rounded-lg border border-white/10 bg-zinc-900/90 py-1.5 pr-3 pl-9 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-rose-500/50 focus:outline-none"
            />
          </div>

          {/* Filter Pills & Sort */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Format Chips */}
            <div className="flex items-center rounded-lg border border-white/10 bg-zinc-900/80 p-0.5">
              {FORMAT_OPTIONS.map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setFormatFilter(fmt)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium uppercase transition ${
                    formatFilter === fmt
                      ? 'bg-rose-500 text-white'
                      : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            {/* Status Select */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-rose-500/50 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="unread">Unread</option>
              <option value="reading">Reading</option>
              <option value="completed">Completed</option>
            </select>

            {/* Sort Select */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-rose-500/50 focus:outline-none"
            >
              <option value="recent">Recently Read</option>
              <option value="title">Title (A–Z)</option>
              <option value="added">Date Added</option>
            </select>

            {/* Group by Series Toggle */}
            <button
              type="button"
              onClick={() => setGroupBySeries(!groupBySeries)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                groupBySeries
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                  : 'border-white/10 bg-zinc-900 text-zinc-300 hover:bg-white/8'
              }`}
              title="Group volumes by Series / Folder"
            >
              <Layers className="h-3.5 w-3.5" />
              Series
            </button>
          </div>
        </header>

        {/* Scrollable Library Body */}
        <div className="manga-scroll flex-1 overflow-y-auto px-6 py-6">
          {library.books.length === 0 ? (
            /* Empty Library Welcome State */
            <div className="mx-auto mt-16 flex max-w-lg flex-col items-center rounded-2xl border border-dashed border-white/15 bg-zinc-900/40 px-8 py-12 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400">
                <BookOpen className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-semibold text-white">Your Manga Shelf is Empty</h2>
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                Add a local folder containing your manga volumes or open any{' '}
                <span className="font-medium text-zinc-200">CBZ, CBR, EPUB, or PDF</span> file.
                You can also drag and drop files directly onto this window.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void addFolderDialog()}
                  className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-600"
                >
                  <FolderPlus className="h-4 w-4" />
                  Add Manga Folder
                </button>
                <button
                  type="button"
                  onClick={() => void openFileDialog()}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-white/10"
                >
                  <FilePlus2 className="h-4 w-4" />
                  Open Single File
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Continue Reading Spotlight */}
              {showSpotlight && (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                      Continue Reading
                    </h2>
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {continueReading.map((book) => (
                      <BookCard
                        key={`recent-${book.id}`}
                        book={book}
                        onOpen={(fp) => void openBook(fp)}
                        onRemove={(id) => void removeBook(id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Main Collection */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                    {selectedFolderFilter
                      ? `Folder: ${selectedFolderFilter.split(/[\\/]/).filter(Boolean).pop()}`
                      : sidebarSection === 'recent'
                        ? 'Recent History'
                        : sidebarSection === 'bookmarked'
                          ? 'Bookmarked Volumes'
                          : 'Library Collection'}{' '}
                    <span className="ml-1 font-mono text-zinc-500">
                      ({filteredBooks.length})
                    </span>
                  </h2>
                </div>

                {filteredBooks.length === 0 ? (
                  <p className="py-12 text-center text-xs text-zinc-500">
                    No manga match your current filters.
                  </p>
                ) : seriesGroups ? (
                  <div className="space-y-6">
                    {seriesGroups.map(([seriesName, books]) => (
                      <div key={seriesName}>
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
                          <span>{seriesName}</span>
                          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                            {books.length}
                          </span>
                        </h3>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                          {books.map((book) => (
                            <BookCard
                              key={book.id}
                              book={book}
                              onOpen={(fp) => void openBook(fp)}
                              onRemove={(id) => void removeBook(id)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {filteredBooks.map((book) => (
                      <BookCard
                        key={book.id}
                        book={book}
                        onOpen={(fp) => void openBook(fp)}
                        onRemove={(id) => void removeBook(id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

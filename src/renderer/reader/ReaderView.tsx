import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageDescriptor } from '@shared/types';
import { useAppStore } from '@renderer/store/useAppStore';
import { HorizontalStrip, type JumpRequest } from './HorizontalStrip';
import { ReaderHud } from './ReaderHud';

export const ReaderView: React.FC = () => {
  const session = useAppStore((s) => s.activeSession);
  const settings = useAppStore((s) => s.settings);
  const closeBook = useAppStore((s) => s.closeBook);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const saveProgress = useAppStore((s) => s.saveProgress);
  const addBookmark = useAppStore((s) => s.addBookmark);
  const removeBookmark = useAppStore((s) => s.removeBookmark);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfPages, setPdfPages] = useState<PageDescriptor[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const initialPageIndex = session?.initialProgress?.pageIndex ?? 0;
  const [currentPage, setCurrentPage] = useState(initialPageIndex);
  const [jumpRequest, setJumpRequest] = useState<JumpRequest | null>(null);
  const [hudVisible, setHudVisible] = useState(true);

  const hudHoverRef = useRef(false);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPageRef = useRef(initialPageIndex);
  const jumpSeqRef = useRef(0);

  // Load PDF.js document when opening a PDF book
  useEffect(() => {
    if (!session || session.format !== 'pdf' || !session.pdfUrl) {
      setPdfDoc(null);
      setPdfPages([]);
      setPdfLoading(false);
      setPdfError(null);
      return;
    }

    let cancelled = false;
    let loadedDoc: PDFDocumentProxy | null = null;
    setPdfLoading(true);
    setPdfError(null);

    void import('./pdfClient')
      .then(async ({ loadPdfDocument, generatePdfCoverThumbnail }) => {
        const doc = await loadPdfDocument(session.pdfUrl!);
        if (cancelled) {
          void doc.destroy();
          return;
        }
        loadedDoc = doc;
        setPdfDoc(doc);
        const generatedPages: PageDescriptor[] = Array.from({ length: doc.numPages }, (_, i) => ({
          index: i,
          kind: 'pdf',
          sourceRef: String(i + 1),
        }));
        setPdfPages(generatedPages);
        setPdfLoading(false);

        // Also cache PDF thumbnail in the background if library book needs it
        void generatePdfCoverThumbnail(session.pdfUrl!).then((thumb) => {
          if (thumb) {
            void window.mangaApi.savePdfThumbnail(session.bookId, thumb.pageCount, thumb.bytes);
          }
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setPdfError(err instanceof Error ? err.message : 'Failed to load PDF document');
        setPdfLoading(false);
      });

    return () => {
      cancelled = true;
      if (loadedDoc) {
        void loadedDoc.destroy();
      }
    };
  }, [session]);

  const pages = useMemo(() => {
    if (!session) return [];
    return session.format === 'pdf' ? pdfPages : session.pages;
  }, [session, pdfPages]);

  const pageCount = pages.length;

  // Reset current page when switching book
  useEffect(() => {
    const startPage = session?.initialProgress?.pageIndex ?? 0;
    setCurrentPage(startPage);
    latestPageRef.current = startPage;
  }, [session?.bookId, session?.initialProgress?.pageIndex]);

  // Auto-hide HUD timer
  const scheduleHudHide = useCallback(() => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => {
      if (!hudHoverRef.current) {
        setHudVisible(false);
      }
    }, 2600);
  }, []);

  const revealHud = useCallback(() => {
    setHudVisible(true);
    scheduleHudHide();
  }, [scheduleHudHide]);

  useEffect(() => {
    scheduleHudHide();
    return () => {
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    };
  }, [scheduleHudHide]);

  // Debounced reading progress persistence
  const persistProgressNow = useCallback(
    (pageIdx: number) => {
      if (!session || pageCount <= 0) return;
      const clamped = Math.max(0, Math.min(pageCount - 1, pageIdx));
      const ratio = pageCount > 1 ? clamped / (pageCount - 1) : 1;
      void saveProgress(session.bookId, {
        pageIndex: clamped,
        pageCount,
        ratio,
        updatedAt: Date.now(),
      });
    },
    [session, pageCount, saveProgress],
  );

  const handleActivePageChange = useCallback(
    (pageIndex: number) => {
      setCurrentPage(pageIndex);
      latestPageRef.current = pageIndex;

      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      progressTimerRef.current = setTimeout(() => {
        persistProgressNow(pageIndex);
      }, 450);
    },
    [persistProgressNow],
  );

  // Flush reading progress on unmount
  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      persistProgressNow(latestPageRef.current);
    };
  }, [persistProgressNow]);

  const jumpToPage = useCallback(
    (pageIndex: number, behavior: 'auto' | 'smooth' = 'smooth') => {
      if (pageCount <= 0) return;
      const clamped = Math.max(0, Math.min(pageCount - 1, pageIndex));
      jumpSeqRef.current += 1;
      setJumpRequest({ pageIndex: clamped, behavior, seq: jumpSeqRef.current });
    },
    [pageCount],
  );

  const handleZoomDelta = useCallback(
    (delta: number) => {
      const nextZoom = Math.max(0.5, Math.min(3, Number((settings.zoom + delta).toFixed(2))));
      void updateSettings({ zoom: nextZoom });
    },
    [settings.zoom, updateSettings],
  );

  // Keyboard shortcuts
  useEffect(() => {
    if (!session) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      const isRtl = settings.direction === 'rtl';

      switch (e.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A': {
          e.preventDefault();
          jumpToPage(latestPageRef.current + (isRtl ? 1 : -1), 'smooth');
          break;
        }
        case 'ArrowRight':
        case 'd':
        case 'D': {
          e.preventDefault();
          jumpToPage(latestPageRef.current + (isRtl ? -1 : 1), 'smooth');
          break;
        }
        case ' ': {
          e.preventDefault();
          const step = e.shiftKey ? -1 : 1;
          jumpToPage(latestPageRef.current + step, 'smooth');
          break;
        }
        case 'Home': {
          e.preventDefault();
          jumpToPage(0, 'auto');
          break;
        }
        case 'End': {
          e.preventDefault();
          jumpToPage(pageCount - 1, 'auto');
          break;
        }
        case '+':
        case '=': {
          e.preventDefault();
          handleZoomDelta(0.15);
          break;
        }
        case '-':
        case '_': {
          e.preventDefault();
          handleZoomDelta(-0.15);
          break;
        }
        case '0': {
          e.preventDefault();
          void updateSettings({ zoom: 1, fitMode: 'height' });
          break;
        }
        case 'r':
        case 'R': {
          e.preventDefault();
          void updateSettings({ direction: isRtl ? 'ltr' : 'rtl' });
          revealHud();
          break;
        }
        case 'm':
        case 'M': {
          e.preventDefault();
          void updateSettings({
            scrollMode: settings.scrollMode === 'continuous' ? 'snap' : 'continuous',
          });
          revealHud();
          break;
        }
        case 'b':
        case 'B': {
          e.preventDefault();
          const existing = session.bookmarks.find((b) => b.pageIndex === latestPageRef.current);
          if (existing) {
            void removeBookmark(existing.id);
          } else {
            void addBookmark(latestPageRef.current, `Page ${latestPageRef.current + 1}`);
          }
          revealHud();
          break;
        }
        case 'f':
        case 'F': {
          e.preventDefault();
          void window.mangaApi.toggleFullscreen();
          break;
        }
        case 'Escape': {
          e.preventDefault();
          persistProgressNow(latestPageRef.current);
          void closeBook();
          break;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    session,
    settings.direction,
    settings.scrollMode,
    pageCount,
    jumpToPage,
    handleZoomDelta,
    updateSettings,
    addBookmark,
    removeBookmark,
    closeBook,
    persistProgressNow,
    revealHud,
  ]);

  if (!session) return null;

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      onMouseMove={(e) => {
        // Reveal HUD smoothly when pointer moves near top or bottom edges
        if (e.clientY < 64 || e.clientY > window.innerHeight - 84) {
          revealHud();
        }
      }}
    >
      {pdfLoading ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0d0e12] text-zinc-300">
          <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
          <p className="text-sm">Loading PDF pages...</p>
        </div>
      ) : pdfError ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#0d0e12] p-6 text-center text-zinc-300">
          <AlertTriangle className="h-10 w-10 text-rose-400" />
          <div>
            <h2 className="text-base font-semibold text-white">Failed to open PDF</h2>
            <p className="mt-1 text-xs text-zinc-400">{pdfError}</p>
          </div>
          <button
            type="button"
            onClick={() => void closeBook()}
            className="rounded-lg bg-rose-500 px-4 py-2 text-xs font-medium text-white hover:bg-rose-600"
          >
            Back to Library
          </button>
        </div>
      ) : pageCount === 0 ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#0d0e12] p-6 text-center text-zinc-300">
          <AlertTriangle className="h-10 w-10 text-amber-400" />
          <div>
            <h2 className="text-base font-semibold text-white">No readable pages found</h2>
            <p className="mt-1 text-xs text-zinc-400">
              This archive did not contain any supported images or readable EPUB pages.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void closeBook()}
            className="rounded-lg bg-rose-500 px-4 py-2 text-xs font-medium text-white hover:bg-rose-600"
          >
            Back to Library
          </button>
        </div>
      ) : (
        <HorizontalStrip
          bookId={session.bookId}
          pages={pages}
          pdfDoc={pdfDoc}
          settings={settings}
          initialPageIndex={Math.min(initialPageIndex, pageCount - 1)}
          jumpRequest={jumpRequest}
          onActivePageChange={handleActivePageChange}
          onZoomDelta={handleZoomDelta}
          onUserActivity={() => {
            if (hudVisible && !hudHoverRef.current) {
              scheduleHudHide();
            }
          }}
          onViewportClick={() => {
            setHudVisible((v) => {
              const next = !v;
              if (next) scheduleHudHide();
              return next;
            });
          }}
        />
      )}

      <ReaderHud
        visible={hudVisible}
        title={session.metadata.title}
        format={session.format}
        currentPage={currentPage}
        pageCount={pageCount}
        settings={settings}
        bookmarks={session.bookmarks}
        onBack={() => {
          persistProgressNow(latestPageRef.current);
          void closeBook();
        }}
        onJumpToPage={jumpToPage}
        onUpdateSettings={(partial) => void updateSettings(partial)}
        onAddBookmark={(idx, label) => void addBookmark(idx, label)}
        onRemoveBookmark={(id) => void removeBookmark(id)}
        onToggleFullscreen={() => void window.mangaApi.toggleFullscreen()}
        onHoverHud={(hovering) => {
          hudHoverRef.current = hovering;
          if (hovering) {
            if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
            setHudVisible(true);
          } else {
            scheduleHudHide();
          }
        }}
      />
    </div>
  );
};

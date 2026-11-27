import React, { Suspense, useEffect, useState } from 'react';
import { FileUp, Loader2, X } from 'lucide-react';
import { SUPPORTED_EXTENSIONS } from '@shared/types';
import { useAppStore } from './store/useAppStore';
import { LibraryView } from './library/LibraryView';

const ReaderView = React.lazy(() =>
  import('./reader/ReaderView').then((mod) => ({ default: mod.ReaderView })),
);

function hasSupportedExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export const App: React.FC = () => {
  const init = useAppStore((s) => s.init);
  const view = useAppStore((s) => s.view);
  const openingFile = useAppStore((s) => s.openingFile);
  const errorMessage = useAppStore((s) => s.errorMessage);
  const clearError = useAppStore((s) => s.clearError);
  const openBook = useAppStore((s) => s.openBook);

  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  // Global drag-and-drop file opener
  useEffect(() => {
    let dragCounter = 0;

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes('Files')) {
        dragCounter++;
        setDragActive(true);
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) {
        setDragActive(false);
      }
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setDragActive(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const file of files) {
        const filePath = window.mangaApi.getPathForFile(file);
        if (filePath && hasSupportedExtension(filePath)) {
          void openBook(filePath);
          break;
        }
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [openBook]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0d0e12]">
      {view === 'reader' ? (
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-[#0d0e12]">
              <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
            </div>
          }
        >
          <ReaderView />
        </Suspense>
      ) : (
        <LibraryView />
      )}

      {/* Loading Overlay */}
      {openingFile && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/75 backdrop-blur-sm">
          <Loader2 className="h-9 w-9 animate-spin text-rose-500" />
          <p className="text-sm font-medium text-zinc-200">Opening volume...</p>
        </div>
      )}

      {/* Drag & Drop Overlay */}
      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-rose-500/80 bg-zinc-900/90 px-12 py-10 text-center shadow-2xl">
            <FileUp className="h-10 w-10 text-rose-400" />
            <div className="text-base font-semibold text-white">Drop Manga to Open</div>
            <div className="text-xs text-zinc-400">Supports CBZ, CBR, EPUB, and PDF</div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {errorMessage && (
        <div className="fixed right-5 bottom-5 z-50 flex max-w-md items-center gap-3 rounded-xl border border-rose-500/40 bg-zinc-950/95 px-4 py-3 text-xs text-rose-200 shadow-2xl backdrop-blur-md">
          <span className="flex-1">{errorMessage}</span>
          <button
            type="button"
            onClick={clearError}
            className="rounded p-1 text-rose-300 hover:bg-rose-500/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
};

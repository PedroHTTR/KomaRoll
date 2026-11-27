import { create } from 'zustand';
import {
  DEFAULT_READER_SETTINGS,
  type BookFormat,
  type LibrarySnapshot,
  type OpenedBookSession,
  type ReaderSettings,
  type ReadingProgress,
} from '@shared/types';

export type SidebarSection = 'all' | 'recent' | 'bookmarked';
export type StatusFilter = 'all' | 'unread' | 'reading' | 'completed';
export type SortOption = 'recent' | 'title' | 'added';

interface AppState {
  initialized: boolean;
  view: 'library' | 'reader';
  library: LibrarySnapshot;
  settings: ReaderSettings;
  activeSession: OpenedBookSession | null;
  openingFile: boolean;
  errorMessage: string | null;

  // Library UI filters
  sidebarSection: SidebarSection;
  searchQuery: string;
  formatFilter: 'all' | BookFormat;
  statusFilter: StatusFilter;
  sortBy: SortOption;
  groupBySeries: boolean;
  selectedFolderFilter: string | null;

  init: () => Promise<void>;
  openBook: (filePath: string) => Promise<void>;
  openFileDialog: () => Promise<void>;
  closeBook: () => Promise<void>;
  addFolderDialog: () => Promise<void>;
  removeFolder: (folderPath: string) => Promise<void>;
  rescanLibrary: () => Promise<void>;
  removeBook: (bookId: string) => Promise<void>;
  updateSettings: (partial: Partial<ReaderSettings>) => Promise<void>;
  saveProgress: (bookId: string, progress: ReadingProgress) => Promise<void>;
  addBookmark: (pageIndex: number, label?: string) => Promise<void>;
  removeBookmark: (bookmarkId: string) => Promise<void>;
  setSidebarSection: (section: SidebarSection) => void;
  setSearchQuery: (q: string) => void;
  setFormatFilter: (f: 'all' | BookFormat) => void;
  setStatusFilter: (s: StatusFilter) => void;
  setSortBy: (s: SortOption) => void;
  setGroupBySeries: (v: boolean) => void;
  setSelectedFolderFilter: (folder: string | null) => void;
  clearError: () => void;
}

let unsubLibrary: (() => void) | null = null;
let unsubOpenFromOs: (() => void) | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  view: 'library',
  library: { folders: [], books: [], scanning: false },
  settings: { ...DEFAULT_READER_SETTINGS },
  activeSession: null,
  openingFile: false,
  errorMessage: null,

  sidebarSection: 'all',
  searchQuery: '',
  formatFilter: 'all',
  statusFilter: 'all',
  sortBy: 'recent',
  groupBySeries: false,
  selectedFolderFilter: null,

  init: async () => {
    if (get().initialized) return;
    try {
      const [library, settings] = await Promise.all([
        window.mangaApi.getLibrary(),
        window.mangaApi.getSettings(),
      ]);

      unsubLibrary?.();
      unsubLibrary = window.mangaApi.onLibraryUpdated((snapshot) => {
        set({ library: snapshot });
      });

      unsubOpenFromOs?.();
      unsubOpenFromOs = window.mangaApi.onOpenFileFromOs((filePath) => {
        void get().openBook(filePath);
      });

      set({ library, settings, initialized: true });
    } catch (err) {
      set({
        initialized: true,
        errorMessage: err instanceof Error ? err.message : 'Failed to initialize app',
      });
    }
  },

  openBook: async (filePath: string) => {
    set({ openingFile: true, errorMessage: null });
    try {
      const prev = get().activeSession;
      if (prev) {
        await window.mangaApi.closeBook(prev.bookId).catch(() => {});
      }
      const session = await window.mangaApi.openBook(filePath);

      // Apply book's declared default direction (e.g. EPUB rtl / ComicInfo Manga=Yes) if present
      if (session.metadata.defaultDirection) {
        const currentSettings = get().settings;
        if (currentSettings.direction !== session.metadata.defaultDirection) {
          const updated = await window.mangaApi.updateSettings({
            direction: session.metadata.defaultDirection,
          });
          set({ settings: updated });
        }
      }

      set({
        activeSession: session,
        view: 'reader',
        openingFile: false,
      });
    } catch (err) {
      set({
        openingFile: false,
        errorMessage:
          err instanceof Error ? err.message : 'Failed to open the selected file',
      });
    }
  },

  openFileDialog: async () => {
    const selected = await window.mangaApi.openFileDialog();
    if (selected) {
      await get().openBook(selected);
    }
  },

  closeBook: async () => {
    const session = get().activeSession;
    set({ view: 'library', activeSession: null });
    if (session) {
      await window.mangaApi.closeBook(session.bookId).catch(() => {});
    }
    const library = await window.mangaApi.getLibrary().catch(() => null);
    if (library) {
      set({ library });
    }
  },

  addFolderDialog: async () => {
    const folder = await window.mangaApi.openFolderDialog();
    if (!folder) return;
    const library = await window.mangaApi.addLibraryFolder(folder);
    set({ library });
  },

  removeFolder: async (folderPath: string) => {
    const library = await window.mangaApi.removeLibraryFolder(folderPath);
    const currentFilter = get().selectedFolderFilter;
    set({
      library,
      selectedFolderFilter: currentFilter === folderPath ? null : currentFilter,
    });
  },

  rescanLibrary: async () => {
    const library = await window.mangaApi.rescanLibrary();
    set({ library });
  },

  removeBook: async (bookId: string) => {
    const library = await window.mangaApi.removeBook(bookId);
    set({ library });
  },

  updateSettings: async (partial: Partial<ReaderSettings>) => {
    // Optimistically update for instant UI responsiveness
    set((s) => ({ settings: { ...s.settings, ...partial } }));
    const saved = await window.mangaApi.updateSettings(partial);
    set({ settings: saved });
  },

  saveProgress: async (bookId: string, progress: ReadingProgress) => {
    await window.mangaApi.saveProgress(bookId, progress);
  },

  addBookmark: async (pageIndex: number, label?: string) => {
    const session = get().activeSession;
    if (!session) return;
    const bookmarks = await window.mangaApi.addBookmark(session.bookId, pageIndex, label);
    set((s) =>
      s.activeSession && s.activeSession.bookId === session.bookId
        ? { activeSession: { ...s.activeSession, bookmarks } }
        : s,
    );
  },

  removeBookmark: async (bookmarkId: string) => {
    const session = get().activeSession;
    if (!session) return;
    const bookmarks = await window.mangaApi.removeBookmark(session.bookId, bookmarkId);
    set((s) =>
      s.activeSession && s.activeSession.bookId === session.bookId
        ? { activeSession: { ...s.activeSession, bookmarks } }
        : s,
    );
  },

  setSidebarSection: (sidebarSection) =>
    set({ sidebarSection, selectedFolderFilter: null }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setFormatFilter: (formatFilter) => set({ formatFilter }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setSortBy: (sortBy) => set({ sortBy }),
  setGroupBySeries: (groupBySeries) => set({ groupBySeries }),
  setSelectedFolderFilter: (selectedFolderFilter) =>
    set({ selectedFolderFilter, sidebarSection: 'all' }),
  clearError: () => set({ errorMessage: null }),
}));

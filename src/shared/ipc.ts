import type {
  Bookmark,
  LibrarySnapshot,
  OpenedBookSession,
  ReaderSettings,
  ReadingProgress,
} from './types';

export const IPC_CHANNELS = {
  OPEN_FILE_DIALOG: 'dialog:openFile',
  OPEN_FOLDER_DIALOG: 'dialog:openFolder',
  OPEN_BOOK: 'book:open',
  CLOSE_BOOK: 'book:close',
  GET_LIBRARY: 'library:get',
  ADD_LIBRARY_FOLDER: 'library:addFolder',
  REMOVE_LIBRARY_FOLDER: 'library:removeFolder',
  RESCAN_LIBRARY: 'library:rescan',
  REMOVE_BOOK: 'library:removeBook',
  SAVE_PROGRESS: 'library:saveProgress',
  ADD_BOOKMARK: 'library:addBookmark',
  REMOVE_BOOKMARK: 'library:removeBookmark',
  SAVE_PDF_THUMBNAIL: 'library:savePdfThumbnail',
  GET_SETTINGS: 'settings:get',
  UPDATE_SETTINGS: 'settings:update',
  TOGGLE_FULLSCREEN: 'window:toggleFullscreen',
  GET_PATH_FOR_FILE: 'file:getPath',
  LIBRARY_UPDATED: 'library:updated',
  OPEN_FILE_FROM_OS: 'app:openFileFromOs',
} as const;

export interface MangaApi {
  openFileDialog: () => Promise<string | null>;
  openFolderDialog: () => Promise<string | null>;
  openBook: (filePath: string) => Promise<OpenedBookSession>;
  closeBook: (bookId: string) => Promise<void>;
  getLibrary: () => Promise<LibrarySnapshot>;
  addLibraryFolder: (folderPath: string) => Promise<LibrarySnapshot>;
  removeLibraryFolder: (folderPath: string) => Promise<LibrarySnapshot>;
  rescanLibrary: () => Promise<LibrarySnapshot>;
  removeBook: (bookId: string) => Promise<LibrarySnapshot>;
  saveProgress: (bookId: string, progress: ReadingProgress) => Promise<void>;
  addBookmark: (bookId: string, pageIndex: number, label?: string) => Promise<Bookmark[]>;
  removeBookmark: (bookId: string, bookmarkId: string) => Promise<Bookmark[]>;
  savePdfThumbnail: (bookId: string, pageCount: number, imageBytes: Uint8Array) => Promise<boolean>;
  getSettings: () => Promise<ReaderSettings>;
  updateSettings: (partial: Partial<ReaderSettings>) => Promise<ReaderSettings>;
  toggleFullscreen: () => Promise<boolean>;
  getPathForFile: (file: File) => string;
  onLibraryUpdated: (callback: (snapshot: LibrarySnapshot) => void) => () => void;
  onOpenFileFromOs: (callback: (filePath: string) => void) => () => void;
}

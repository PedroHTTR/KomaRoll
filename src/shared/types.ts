export type BookFormat = 'cbz' | 'cbr' | 'epub' | 'pdf';
export type ReadingDirection = 'rtl' | 'ltr';
export type ScrollMode = 'continuous' | 'snap';
export type FitMode = 'height' | 'screen' | 'original' | 'custom';
export type PageKind = 'image' | 'xhtml' | 'pdf';

export type ReaderBackground = '#0d0e12' | '#16181f' | '#000000' | '#f4f1ea';

export interface PageDescriptor {
  index: number;
  kind: PageKind;
  /** Original entry path inside archive or PDF page number (1-based) */
  sourceRef: string;
  width?: number;
  height?: number;
  mimeType?: string;
  label?: string;
}

export interface BookMetadata {
  title: string;
  series?: string;
  author?: string;
  defaultDirection?: ReadingDirection;
}

export interface OpenedBookSession {
  bookId: string;
  filePath: string;
  format: BookFormat;
  metadata: BookMetadata;
  pageCount: number;
  pages: PageDescriptor[];
  /** Present for PDFs: manga-page://file/<bookId> */
  pdfUrl?: string;
  /** Existing saved progress if present */
  initialProgress: ReadingProgress | null;
  bookmarks: Bookmark[];
}

export interface ReadingProgress {
  pageIndex: number;
  pageCount: number;
  /** 0..1 normalized reading completion */
  ratio: number;
  updatedAt: number;
}

export interface Bookmark {
  id: string;
  pageIndex: number;
  label: string;
  createdAt: number;
}

export interface LibraryBook {
  id: string;
  filePath: string;
  fileName: string;
  folderPath: string;
  format: BookFormat;
  title: string;
  series: string;
  author?: string;
  fileSize: number;
  modifiedAt: number;
  addedAt: number;
  pageCount: number | null;
  thumbnailReady: boolean;
  lastReadAt: number | null;
  progress: ReadingProgress | null;
  bookmarks: Bookmark[];
}

export interface LibrarySnapshot {
  folders: string[];
  books: LibraryBook[];
  scanning: boolean;
}

export interface ReaderSettings {
  direction: ReadingDirection;
  scrollMode: ScrollMode;
  fitMode: FitMode;
  zoom: number; // 0.5 to 3.0
  pageGap: number; // 0 to 32 px
  wheelScrollSpeed: number; // 0.5 to 2.5
  invertWheelInRtl: boolean; // default false: wheel down = next page (left in RTL)
  backgroundColor: ReaderBackground;
  preloadAhead: number; // default 3
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  direction: 'rtl',
  scrollMode: 'continuous',
  fitMode: 'height',
  zoom: 1,
  pageGap: 8,
  wheelScrollSpeed: 1.15,
  invertWheelInRtl: false,
  backgroundColor: '#0d0e12',
  preloadAhead: 3,
};

export const SUPPORTED_EXTENSIONS = ['.cbz', '.cbr', '.epub', '.pdf'] as const;

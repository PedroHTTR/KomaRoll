import type { FitMode, ReadingDirection } from '@shared/types';

export interface Dimensions {
  width: number;
  height: number;
}

export interface StripLayout {
  /** Left X coordinate (in px) for each visual slot */
  offsets: number[];
  /** Width (in px) for each visual slot */
  widths: number[];
  /** Height (in px) for each visual slot */
  heights: number[];
  /** Total scrollable width of the horizontal strip */
  totalWidth: number;
}

export interface VisibleRange {
  startVisualIndex: number;
  endVisualIndex: number;
}

/** Standard manga tankobon aspect ratio fallback (B6 ~ 0.707) */
export const DEFAULT_PAGE_ASPECT = 0.707;

/**
 * Maps a visual slot index (left-to-right 0..N-1 in the DOM) to logical book page index (0..N-1).
 * In RTL mode, Page 0 sits at the rightmost visual slot (N-1) so reading flows right-to-left.
 */
export function visualIndexToPageIndex(
  visualIndex: number,
  pageCount: number,
  direction: ReadingDirection,
): number {
  if (pageCount <= 0) return 0;
  const clamped = Math.max(0, Math.min(pageCount - 1, visualIndex));
  return direction === 'rtl' ? pageCount - 1 - clamped : clamped;
}

/**
 * Maps a logical book page index (0..N-1) to its visual slot index (left-to-right 0..N-1).
 */
export function pageIndexToVisualIndex(
  pageIndex: number,
  pageCount: number,
  direction: ReadingDirection,
): number {
  if (pageCount <= 0) return 0;
  const clamped = Math.max(0, Math.min(pageCount - 1, pageIndex));
  return direction === 'rtl' ? pageCount - 1 - clamped : clamped;
}

/**
 * Computes rendered pixel dimensions for a page given viewport size, fit mode, and zoom multiplier.
 */
export function computePageDisplaySize(
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
  viewportWidth: number,
  viewportHeight: number,
  fitMode: FitMode,
  zoom: number,
): Dimensions {
  const safeVpW = Math.max(320, viewportWidth);
  const safeVpH = Math.max(240, viewportHeight);
  const safeZoom = Math.max(0.5, Math.min(3, zoom));

  const hasNatural =
    typeof naturalWidth === 'number' &&
    typeof naturalHeight === 'number' &&
    naturalWidth > 0 &&
    naturalHeight > 0;

  const aspect = hasNatural ? naturalWidth / naturalHeight : DEFAULT_PAGE_ASPECT;
  const natW = hasNatural ? naturalWidth : Math.round(safeVpH * DEFAULT_PAGE_ASPECT);
  const natH = hasNatural ? naturalHeight : safeVpH;

  let baseW: number;
  let baseH: number;

  switch (fitMode) {
    case 'height': {
      baseH = safeVpH;
      baseW = baseH * aspect;
      break;
    }
    case 'screen': {
      const scaleH = safeVpH / natH;
      const scaleW = safeVpW / natW;
      const scale = Math.min(scaleH, scaleW);
      baseW = natW * scale;
      baseH = natH * scale;
      break;
    }
    case 'original': {
      baseW = natW;
      baseH = natH;
      break;
    }
    case 'custom':
    default: {
      baseH = safeVpH * safeZoom;
      baseW = baseH * aspect;
      return {
        width: Math.max(120, Math.round(baseW)),
        height: Math.max(120, Math.round(baseH)),
      };
    }
  }

  return {
    width: Math.max(120, Math.round(baseW * safeZoom)),
    height: Math.max(120, Math.round(baseH * safeZoom)),
  };
}

/**
 * Computes cumulative X positions and total strip width for all visual slots.
 */
export function computeStripLayout(
  visualSizes: Dimensions[],
  gap: number,
  sidePadding = 48,
): StripLayout {
  const count = visualSizes.length;
  const offsets = new Array<number>(count);
  const widths = new Array<number>(count);
  const heights = new Array<number>(count);

  let cursor = sidePadding;
  for (let i = 0; i < count; i++) {
    offsets[i] = cursor;
    widths[i] = visualSizes[i].width;
    heights[i] = visualSizes[i].height;
    cursor += visualSizes[i].width;
    if (i < count - 1) {
      cursor += gap;
    }
  }

  const totalWidth = count === 0 ? 0 : cursor + sidePadding;
  return { offsets, widths, heights, totalWidth };
}

/**
 * Computes which visual slot indices overlap the viewport plus overscan buffers.
 */
export function getVisibleVisualRange(
  scrollLeft: number,
  viewportWidth: number,
  layout: StripLayout,
  overscanLeft: number,
  overscanRight: number,
): VisibleRange {
  const count = layout.offsets.length;
  if (count === 0) {
    return { startVisualIndex: 0, endVisualIndex: -1 };
  }

  const viewStart = scrollLeft;
  const viewEnd = scrollLeft + viewportWidth;

  // Binary search for first slot whose right edge > viewStart
  let lo = 0;
  let hi = count - 1;
  let firstVisible = count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const rightEdge = layout.offsets[mid] + layout.widths[mid];
    if (rightEdge >= viewStart) {
      firstVisible = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  // Advance to last visible slot
  let lastVisible = firstVisible;
  while (lastVisible + 1 < count && layout.offsets[lastVisible + 1] <= viewEnd) {
    lastVisible++;
  }

  return {
    startVisualIndex: Math.max(0, firstVisible - overscanLeft),
    endVisualIndex: Math.min(count - 1, lastVisible + overscanRight),
  };
}

/**
 * Finds the logical book page index currently closest to the horizontal center of the viewport.
 */
export function getActivePageIndex(
  scrollLeft: number,
  viewportWidth: number,
  layout: StripLayout,
  direction: ReadingDirection,
): number {
  const count = layout.offsets.length;
  if (count === 0) return 0;

  const viewportCenter = scrollLeft + viewportWidth / 2;

  let lo = 0;
  let hi = count - 1;
  let bestVisual = 0;
  let bestDist = Number.POSITIVE_INFINITY;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midStart = layout.offsets[mid];
    const midEnd = midStart + layout.widths[mid];
    const midCenter = (midStart + midEnd) / 2;
    const dist = Math.abs(viewportCenter - midCenter);

    if (dist < bestDist) {
      bestDist = dist;
      bestVisual = mid;
    }

    if (viewportCenter < midStart) {
      hi = mid - 1;
    } else if (viewportCenter > midEnd) {
      lo = mid + 1;
    } else {
      bestVisual = mid;
      break;
    }
  }

  return visualIndexToPageIndex(bestVisual, count, direction);
}

/**
 * Computes scrollLeft that centers a target logical page in the viewport.
 */
export function computeScrollLeftForPage(
  pageIndex: number,
  viewportWidth: number,
  layout: StripLayout,
  direction: ReadingDirection,
): number {
  const count = layout.offsets.length;
  if (count === 0) return 0;

  const visualIndex = pageIndexToVisualIndex(pageIndex, count, direction);
  const slotCenter = layout.offsets[visualIndex] + layout.widths[visualIndex] / 2;
  const maxScroll = Math.max(0, layout.totalWidth - viewportWidth);
  return Math.max(0, Math.min(maxScroll, Math.round(slotCenter - viewportWidth / 2)));
}

/**
 * Preserves the exact focal point under the viewport center when zooming or resizing.
 */
export function computeZoomAnchorScrollLeft(
  oldScrollLeft: number,
  oldTotalWidth: number,
  newTotalWidth: number,
  viewportWidth: number,
): number {
  if (oldTotalWidth <= 0 || newTotalWidth <= 0) return 0;
  const centerRatio = (oldScrollLeft + viewportWidth / 2) / oldTotalWidth;
  const targetScroll = centerRatio * newTotalWidth - viewportWidth / 2;
  const maxScroll = Math.max(0, newTotalWidth - viewportWidth);
  return Math.max(0, Math.min(maxScroll, Math.round(targetScroll)));
}

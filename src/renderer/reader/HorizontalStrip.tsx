import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageDescriptor, ReaderSettings } from '@shared/types';
import {
  computePageDisplaySize,
  computeScrollLeftForPage,
  computeStripLayout,
  computeZoomAnchorScrollLeft,
  getActivePageIndex,
  getVisibleVisualRange,
  pageIndexToVisualIndex,
  visualIndexToPageIndex,
  type Dimensions,
  type StripLayout,
  type VisibleRange,
} from './sidescrollerMath';
import { ImagePageSlot } from './ImagePageSlot';
import { PdfPageSlot } from './PdfPageSlot';
import { EpubXhtmlSlot } from './EpubXhtmlSlot';

export interface JumpRequest {
  pageIndex: number;
  behavior: 'auto' | 'smooth';
  seq: number;
}

interface HorizontalStripProps {
  bookId: string;
  pages: PageDescriptor[];
  pdfDoc: PDFDocumentProxy | null;
  settings: ReaderSettings;
  initialPageIndex: number;
  jumpRequest: JumpRequest | null;
  onActivePageChange: (pageIndex: number) => void;
  onZoomDelta: (delta: number) => void;
  onUserActivity: () => void;
  onViewportClick: () => void;
}

export const HorizontalStrip: React.FC<HorizontalStripProps> = ({
  bookId,
  pages,
  pdfDoc,
  settings,
  initialPageIndex,
  jumpRequest,
  onActivePageChange,
  onZoomDelta,
  onUserActivity,
  onViewportClick,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Dimensions>({ width: 0, height: 0 });
  const [dimsVersion, setDimsVersion] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [activePage, setActivePage] = useState(initialPageIndex);
  const [visibleRange, setVisibleRange] = useState<VisibleRange>({
    startVisualIndex: 0,
    endVisualIndex: -1,
  });

  // Ref-driven scroll position avoids 60-120fps React re-renders during continuous scrolling
  const scrollLeftRef = useRef(0);
  const naturalDimsRef = useRef<Map<number, Dimensions>>(new Map());
  const preloadCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const activePageRef = useRef<number>(initialPageIndex);
  const initializedBookRef = useRef<string | null>(null);
  const prevLayoutMetaRef = useRef<{
    totalWidth: number;
    direction: ReaderSettings['direction'];
    fitMode: ReaderSettings['fitMode'];
    zoom: number;
    pageGap: number;
  } | null>(null);

  // Smooth wheel velocity state
  const wheelTargetRef = useRef<number | null>(null);
  const wheelRafRef = useRef<number | null>(null);
  const snapCooldownRef = useRef<number>(0);

  // Drag-to-pan state
  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
    moved: boolean;
  } | null>(null);

  // Reset per-book caches when book changes
  useEffect(() => {
    naturalDimsRef.current.clear();
    for (const img of preloadCacheRef.current.values()) {
      img.src = '';
    }
    preloadCacheRef.current.clear();
    initializedBookRef.current = null;
    prevLayoutMetaRef.current = null;
    activePageRef.current = initialPageIndex;
    setActivePage(initialPageIndex);
    setDimsVersion((v) => v + 1);
  }, [bookId, initialPageIndex]);

  // Measure viewport via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setViewport((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sidePadding =
    settings.scrollMode === 'snap' ? Math.max(48, Math.round(viewport.width / 2)) : 48;

  // Compute display sizes in visual (left-to-right) order
  const layout = useMemo(() => {
    const count = pages.length;
    const visualSizes: Dimensions[] = new Array(count);
    const natMap = naturalDimsRef.current;

    for (let v = 0; v < count; v++) {
      const pageIdx = visualIndexToPageIndex(v, count, settings.direction);
      const measured = natMap.get(pageIdx);
      const pageDesc = pages[pageIdx];
      visualSizes[v] = computePageDisplaySize(
        measured?.width ?? pageDesc?.width,
        measured?.height ?? pageDesc?.height,
        viewport.width || 1280,
        viewport.height || 800,
        settings.fitMode,
        settings.zoom,
      );
    }

    return computeStripLayout(visualSizes, settings.pageGap, sidePadding);
    // dimsVersion intentionally invalidates layout when images report natural dimensions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pages,
    viewport.width,
    viewport.height,
    settings.direction,
    settings.fitMode,
    settings.zoom,
    settings.pageGap,
    sidePadding,
    dimsVersion,
  ]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const overscanLeft = settings.direction === 'rtl' ? settings.preloadAhead : 2;
  const overscanRight = settings.direction === 'rtl' ? 2 : settings.preloadAhead;

  const syncVisibleRange = useCallback(
    (currentLeft: number, vpW: number, currentLayout: StripLayout) => {
      scrollLeftRef.current = currentLeft;
      const next = getVisibleVisualRange(
        currentLeft,
        vpW || 1280,
        currentLayout,
        overscanLeft,
        overscanRight,
      );
      setVisibleRange((prev) =>
        prev.startVisualIndex === next.startVisualIndex &&
        prev.endVisualIndex === next.endVisualIndex
          ? prev
          : next,
      );
    },
    [overscanLeft, overscanRight],
  );

  // Recompute visible range when layout, viewport, or overscan settings change
  useEffect(() => {
    syncVisibleRange(scrollLeftRef.current, viewport.width, layout);
  }, [layout, viewport.width, syncVisibleRange]);

  // Initialize scroll position when book & viewport are ready
  useEffect(() => {
    const el = containerRef.current;
    if (!el || viewport.width <= 0 || pages.length === 0) return;

    if (initializedBookRef.current !== bookId) {
      const targetLeft = computeScrollLeftForPage(
        initialPageIndex,
        viewport.width,
        layout,
        settings.direction,
      );
      el.scrollLeft = targetLeft;
      syncVisibleRange(targetLeft, viewport.width, layout);
      activePageRef.current = initialPageIndex;
      setActivePage(initialPageIndex);
      initializedBookRef.current = bookId;
      prevLayoutMetaRef.current = {
        totalWidth: layout.totalWidth,
        direction: settings.direction,
        fitMode: settings.fitMode,
        zoom: settings.zoom,
        pageGap: settings.pageGap,
      };
      onActivePageChange(initialPageIndex);
    }
  }, [
    bookId,
    pages.length,
    viewport.width,
    layout,
    initialPageIndex,
    settings.direction,
    settings.fitMode,
    settings.zoom,
    settings.pageGap,
    syncVisibleRange,
    onActivePageChange,
  ]);

  // Preserve visual anchor on direction/zoom/fitMode/gap changes
  useEffect(() => {
    const el = containerRef.current;
    const prev = prevLayoutMetaRef.current;
    if (!el || !prev || initializedBookRef.current !== bookId || viewport.width <= 0) {
      return;
    }

    const directionChanged = prev.direction !== settings.direction;
    const zoomOrFitChanged =
      prev.zoom !== settings.zoom ||
      prev.fitMode !== settings.fitMode ||
      prev.pageGap !== settings.pageGap;

    if (directionChanged) {
      const targetLeft = computeScrollLeftForPage(
        activePageRef.current,
        viewport.width,
        layout,
        settings.direction,
      );
      el.scrollLeft = targetLeft;
      syncVisibleRange(targetLeft, viewport.width, layout);
    } else if (zoomOrFitChanged && prev.totalWidth > 0 && layout.totalWidth > 0) {
      const targetLeft =
        settings.scrollMode === 'snap'
          ? computeScrollLeftForPage(
              activePageRef.current,
              viewport.width,
              layout,
              settings.direction,
            )
          : computeZoomAnchorScrollLeft(
              el.scrollLeft,
              prev.totalWidth,
              layout.totalWidth,
              viewport.width,
            );
      el.scrollLeft = targetLeft;
      syncVisibleRange(targetLeft, viewport.width, layout);
    }

    prevLayoutMetaRef.current = {
      totalWidth: layout.totalWidth,
      direction: settings.direction,
      fitMode: settings.fitMode,
      zoom: settings.zoom,
      pageGap: settings.pageGap,
    };
  }, [
    bookId,
    layout,
    viewport.width,
    settings.direction,
    settings.fitMode,
    settings.zoom,
    settings.pageGap,
    settings.scrollMode,
    syncVisibleRange,
  ]);

  // Handle explicit jump requests (scrubber, bookmarks, keyboard, prev/next)
  useEffect(() => {
    if (!jumpRequest) return;
    const el = containerRef.current;
    if (!el || viewport.width <= 0 || pages.length === 0) return;

    if (wheelRafRef.current !== null) {
      cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = null;
      wheelTargetRef.current = null;
    }

    const clamped = Math.max(0, Math.min(pages.length - 1, jumpRequest.pageIndex));
    const targetLeft = computeScrollLeftForPage(
      clamped,
      viewport.width,
      layoutRef.current,
      settings.direction,
    );

    el.scrollTo({
      left: targetLeft,
      behavior: jumpRequest.behavior,
    });
    if (jumpRequest.behavior === 'auto') {
      syncVisibleRange(targetLeft, viewport.width, layoutRef.current);
    }
    activePageRef.current = clamped;
    setActivePage(clamped);
    onActivePageChange(clamped);
  }, [jumpRequest, viewport.width, pages.length, settings.direction, syncVisibleRange, onActivePageChange]);

  // Update natural dimensions with zero-jump left scroll compensation
  const handleDimensions = useCallback(
    (pageIndex: number, naturalWidth: number, naturalHeight: number) => {
      if (naturalWidth <= 0 || naturalHeight <= 0) return;
      const existing = naturalDimsRef.current.get(pageIndex);
      if (
        existing &&
        Math.abs(existing.width - naturalWidth) < 2 &&
        Math.abs(existing.height - naturalHeight) < 2
      ) {
        return;
      }

      const oldSize = computePageDisplaySize(
        existing?.width,
        existing?.height,
        viewport.width || 1280,
        viewport.height || 800,
        settings.fitMode,
        settings.zoom,
      );
      const newSize = computePageDisplaySize(
        naturalWidth,
        naturalHeight,
        viewport.width || 1280,
        viewport.height || 800,
        settings.fitMode,
        settings.zoom,
      );

      naturalDimsRef.current.set(pageIndex, { width: naturalWidth, height: naturalHeight });

      const deltaWidth = newSize.width - oldSize.width;
      const el = containerRef.current;
      if (el && Math.abs(deltaWidth) >= 2 && pages.length > 0) {
        const visualIdx = pageIndexToVisualIndex(pageIndex, pages.length, settings.direction);
        const curLayout = layoutRef.current;
        const slotLeft = curLayout.offsets[visualIdx] ?? 0;
        const viewportCenter = el.scrollLeft + el.clientWidth / 2;
        if (slotLeft + oldSize.width / 2 < viewportCenter) {
          el.scrollLeft += deltaWidth;
          scrollLeftRef.current = el.scrollLeft;
        }
      }

      setDimsVersion((v) => v + 1);
    },
    [viewport.width, viewport.height, settings.fitMode, settings.zoom, settings.direction, pages.length],
  );

  // Sync virtual window + active page on scroll without per-pixel React re-renders
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const currentLeft = el.scrollLeft;
    syncVisibleRange(currentLeft, el.clientWidth, layoutRef.current);

    const active = getActivePageIndex(
      currentLeft,
      el.clientWidth,
      layoutRef.current,
      settings.direction,
    );
    if (active !== activePageRef.current) {
      activePageRef.current = active;
      setActivePage(active);
      onActivePageChange(active);
    }
  }, [settings.direction, syncVisibleRange, onActivePageChange]);

  // Smooth wheel-to-horizontal scrolling (with RTL reading semantics & Ctrl+Wheel zoom)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const animateWheel = () => {
      const target = wheelTargetRef.current;
      if (target === null) {
        wheelRafRef.current = null;
        return;
      }
      const diff = target - el.scrollLeft;
      if (Math.abs(diff) < 0.75) {
        el.scrollLeft = target;
        wheelTargetRef.current = null;
        wheelRafRef.current = null;
        return;
      }
      el.scrollLeft += diff * 0.24;
      wheelRafRef.current = requestAnimationFrame(animateWheel);
    };

    const onWheel = (e: WheelEvent) => {
      onUserActivity();

      // Ctrl + Wheel => Zoom
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const step = e.deltaY < 0 ? 0.15 : -0.15;
        onZoomDelta(step);
        return;
      }

      // Allow vertical pan when zoomed taller than viewport and Shift is held
      if (e.shiftKey && el.scrollHeight > el.clientHeight) {
        return;
      }

      e.preventDefault();

      const useHorizontalDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const primaryDelta = useHorizontalDelta ? e.deltaX : e.deltaY;
      if (primaryDelta === 0) return;

      // Page-Snap Mode: step cleanly one page at a time
      if (settings.scrollMode === 'snap') {
        const now = performance.now();
        if (now - snapCooldownRef.current < 165) return;
        snapCooldownRef.current = now;

        let pageStep: number;
        if (useHorizontalDelta) {
          const moveRight = primaryDelta > 0;
          pageStep = settings.direction === 'rtl' ? (moveRight ? -1 : 1) : moveRight ? 1 : -1;
        } else {
          const forward = primaryDelta > 0;
          const effectiveForward =
            settings.direction === 'rtl' && settings.invertWheelInRtl ? !forward : forward;
          pageStep = effectiveForward ? 1 : -1;
        }

        const nextPage = Math.max(0, Math.min(pages.length - 1, activePageRef.current + pageStep));
        const targetLeft = computeScrollLeftForPage(
          nextPage,
          el.clientWidth,
          layoutRef.current,
          settings.direction,
        );
        el.scrollTo({ left: targetLeft, behavior: 'smooth' });
        return;
      }

      // Continuous Sidescroller Mode: smooth horizontal translation
      let horizontalDelta: number;
      if (useHorizontalDelta) {
        horizontalDelta = primaryDelta * settings.wheelScrollSpeed;
      } else {
        const sign =
          settings.direction === 'rtl' ? (settings.invertWheelInRtl ? 1 : -1) : 1;
        horizontalDelta = primaryDelta * settings.wheelScrollSpeed * 1.45 * sign;
      }

      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const base = wheelTargetRef.current ?? el.scrollLeft;
      wheelTargetRef.current = Math.max(0, Math.min(maxScroll, base + horizontalDelta));

      if (wheelRafRef.current === null) {
        wheelRafRef.current = requestAnimationFrame(animateWheel);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelRafRef.current !== null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
    };
  }, [
    pages.length,
    settings.direction,
    settings.scrollMode,
    settings.wheelScrollSpeed,
    settings.invertWheelInRtl,
    onZoomDelta,
    onUserActivity,
  ]);

  // Click-and-drag panning
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input')) return;

    const el = containerRef.current;
    if (!el) return;

    if (wheelRafRef.current !== null) {
      cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = null;
      wheelTargetRef.current = null;
    }

    el.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: el.scrollLeft,
      startScrollTop: el.scrollTop,
      moved: false,
    };
    setIsDragging(true);
    onUserActivity();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || !drag.active) return;
    const el = containerRef.current;
    if (!el) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      drag.moved = true;
    }

    el.scrollLeft = drag.startScrollLeft - dx;
    if (el.scrollHeight > el.clientHeight) {
      el.scrollTop = drag.startScrollTop - dy;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const el = containerRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    const wasClick = !drag.moved;
    dragStateRef.current = null;
    setIsDragging(false);
    if (wasClick) {
      onViewportClick();
    }
  };

  // Persistent, non-aborting image preloader driven strictly by activePage changes
  useEffect(() => {
    if (pages.length === 0) return;
    const cache = preloadCacheRef.current;
    const keepMin = activePage - 2;
    const keepMax = activePage + settings.preloadAhead + 1;

    // Evict far-away preloaded image handles so browser frees decoded bitmaps
    for (const [idx, img] of cache.entries()) {
      if (idx < keepMin || idx > keepMax) {
        img.src = '';
        cache.delete(idx);
      }
    }

    // Warm upcoming pages in reading direction
    for (let step = 1; step <= settings.preloadAhead; step++) {
      const idx = activePage + step;
      if (idx >= pages.length) break;
      if (cache.has(idx)) continue;
      const page = pages[idx];
      if (page?.kind !== 'image') continue;

      const img = new Image();
      img.decoding = 'async';
      img.src = `manga-page://book/${encodeURIComponent(bookId)}/page/${idx}`;
      void img.decode?.().catch(() => {});
      cache.set(idx, img);
    }
  }, [bookId, pages, settings.preloadAhead, activePage]);

  const maxPageHeight = useMemo(() => {
    let maxH = viewport.height;
    for (let v = visibleRange.startVisualIndex; v <= visibleRange.endVisualIndex; v++) {
      const h = layout.heights[v];
      if (h && h > maxH) maxH = h;
    }
    return maxH;
  }, [visibleRange, layout.heights, viewport.height]);

  const renderedSlots: React.ReactNode[] = [];
  for (let v = visibleRange.startVisualIndex; v <= visibleRange.endVisualIndex; v++) {
    const pageIndex = visualIndexToPageIndex(v, pages.length, settings.direction);
    const descriptor = pages[pageIndex];
    if (!descriptor) continue;

    const slotLeft = layout.offsets[v];
    const slotWidth = layout.widths[v];
    const slotHeight = layout.heights[v];
    const topOffset = Math.max(0, Math.round((maxPageHeight - slotHeight) / 2));

    renderedSlots.push(
      <div
        key={`${bookId}:${pageIndex}`}
        className="absolute shadow-[0_10px_40px_rgba(0,0,0,0.45)]"
        style={{
          left: slotLeft,
          top: topOffset,
          width: slotWidth,
          height: slotHeight,
          scrollSnapAlign: settings.scrollMode === 'snap' ? 'center' : undefined,
        }}
      >
        {descriptor.kind === 'image' && (
          <ImagePageSlot
            bookId={bookId}
            pageIndex={pageIndex}
            width={slotWidth}
            height={slotHeight}
            onDimensions={handleDimensions}
          />
        )}
        {descriptor.kind === 'pdf' && pdfDoc && (
          <PdfPageSlot
            pdfDoc={pdfDoc}
            pageIndex={pageIndex}
            width={slotWidth}
            height={slotHeight}
            onDimensions={handleDimensions}
          />
        )}
        {descriptor.kind === 'xhtml' && (
          <EpubXhtmlSlot
            bookId={bookId}
            pageIndex={pageIndex}
            sourceRef={descriptor.sourceRef}
            width={slotWidth}
            height={slotHeight}
            isDragging={isDragging}
            onDimensions={handleDimensions}
          />
        )}
      </div>,
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`manga-scroll relative h-full w-full overflow-x-auto overflow-y-auto outline-none select-none ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{
        backgroundColor: settings.backgroundColor,
        scrollSnapType: settings.scrollMode === 'snap' ? 'x mandatory' : 'none',
      }}
    >
      <div
        className="relative"
        style={{
          width: Math.max(viewport.width, layout.totalWidth),
          height: Math.max(viewport.height, maxPageHeight),
        }}
      >
        {renderedSlots}
      </div>
    </div>
  );
};

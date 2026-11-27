import { describe, expect, it } from 'vitest';
import {
  computePageDisplaySize,
  computeScrollLeftForPage,
  computeStripLayout,
  computeZoomAnchorScrollLeft,
  getActivePageIndex,
  getVisibleVisualRange,
  pageIndexToVisualIndex,
  visualIndexToPageIndex,
} from '../sidescrollerMath';

describe('sidescrollerMath', () => {
  it('maps visual indices to page indices symmetrically in LTR and RTL', () => {
    const pageCount = 10;

    // LTR: visual 0 -> page 0, visual 9 -> page 9
    expect(visualIndexToPageIndex(0, pageCount, 'ltr')).toBe(0);
    expect(visualIndexToPageIndex(9, pageCount, 'ltr')).toBe(9);
    expect(pageIndexToVisualIndex(3, pageCount, 'ltr')).toBe(3);

    // RTL: visual 9 (rightmost) -> page 0 (Page 1), visual 0 (leftmost) -> page 9 (Last Page)
    expect(visualIndexToPageIndex(9, pageCount, 'rtl')).toBe(0);
    expect(visualIndexToPageIndex(0, pageCount, 'rtl')).toBe(9);
    expect(pageIndexToVisualIndex(0, pageCount, 'rtl')).toBe(9);
    expect(pageIndexToVisualIndex(9, pageCount, 'rtl')).toBe(0);
  });

  it('computes display dimensions accurately across fit modes and zoom levels', () => {
    const fitH = computePageDisplaySize(1000, 1500, 1280, 900, 'height', 1);
    expect(fitH).toEqual({ width: 600, height: 900 });

    const zoomed = computePageDisplaySize(1000, 1500, 1280, 900, 'height', 1.5);
    expect(zoomed).toEqual({ width: 900, height: 1350 });

    // Wide double-page spread in fit-screen mode constrains by width
    const spread = computePageDisplaySize(2400, 1200, 1200, 900, 'screen', 1);
    expect(spread).toEqual({ width: 1200, height: 600 });

    const original = computePageDisplaySize(800, 1200, 1280, 900, 'original', 1);
    expect(original).toEqual({ width: 800, height: 1200 });
  });

  it('computes strip layout, visible range, and active page in RTL and LTR', () => {
    const sizes = Array.from({ length: 10 }, () => ({ width: 500, height: 800 }));
    const layout = computeStripLayout(sizes, 10, 50);

    // First slot starts at sidePadding=50; each step adds 510px
    expect(layout.offsets[0]).toBe(50);
    expect(layout.offsets[1]).toBe(560);
    expect(layout.totalWidth).toBe(50 + 10 * 500 + 9 * 10 + 50);

    // In RTL, jumping to page 0 (Page 1) scrolls near the far right end
    const rtlStartScroll = computeScrollLeftForPage(0, 1000, layout, 'rtl');
    expect(rtlStartScroll).toBe(layout.totalWidth - 1000);
    expect(getActivePageIndex(rtlStartScroll, 1000, layout, 'rtl')).toBe(0);

    // In LTR, jumping to page 0 scrolls to far left (0)
    const ltrStartScroll = computeScrollLeftForPage(0, 1000, layout, 'ltr');
    expect(ltrStartScroll).toBe(0);
    expect(getActivePageIndex(ltrStartScroll, 1000, layout, 'ltr')).toBe(0);

    // Jumping to page 4 centers page 4 in both modes
    const rtlMid = computeScrollLeftForPage(4, 1000, layout, 'rtl');
    expect(getActivePageIndex(rtlMid, 1000, layout, 'rtl')).toBe(4);

    // Visible range includes viewport slots + overscan
    const range = getVisibleVisualRange(1000, 1000, layout, 1, 2);
    expect(range.startVisualIndex).toBe(0);
    expect(range.endVisualIndex).toBe(5);
  });

  it('preserves viewport center ratio when zooming', () => {
    const oldTotal = 5000;
    const newTotal = 10000;
    const vpW = 1000;
    // Viewport centered exactly at 50% (scrollLeft = 2000 -> center = 2500)
    const anchored = computeZoomAnchorScrollLeft(2000, oldTotal, newTotal, vpW);
    // New center should be at 5000 -> scrollLeft = 4500
    expect(anchored).toBe(4500);
  });
});

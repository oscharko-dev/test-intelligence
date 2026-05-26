/**
 * Neutral product mark for the customer-markdown PDF Mappe.
 *
 * The standalone Test Intelligence product ships its own branding; it
 * does not embed any third-party brand asset. This module exposes a
 * minimal, self-authored geometric mark encoded as inline SVG path
 * data so the deterministic customer-markdown PDF Mappe needs no file
 * IO at runtime and the path stays byte-stable across runs.
 *
 * The mark is a clean upward chevron stacked above a horizontal
 * baseline — a simple, professional symbol evoking verification and
 * an evidence ledger. It is drawn with the brand accent colour on the
 * cover plaque by `customer-markdown-pdf-mappe.ts`.
 *
 * Geometry notes:
 *
 *   - The path uses only `M`, `L`, and `Z` commands, all within the
 *     command set the Mappe's `svgPathToPdfOps` renderer supports.
 *   - The mark is horizontally symmetric about the viewBox centre, so
 *     the renderer's outer-group horizontal flip is a visual no-op.
 *   - The viewBox is a square (1000 x 1000) so the cover-plaque scale
 *     (`size / viewBoxH`) keeps the mark centred in its padded square.
 */

/**
 * Inline SVG path data for the neutral product mark. Two filled
 * subpaths: an upward chevron and a baseline bar, both centred on the
 * viewBox. Authored from straight-line primitives only — it contains
 * no third-party brand path data.
 */
export const MARK_PATH_D: string =
  "M500 140L860 460L760 460L500 280L240 460L140 460Z " +
  "M260 600L740 600L740 720L260 720Z";

/** Mark SVG viewBox width. */
export const MARK_VIEWBOX_W: number = 1000;
/** Mark SVG viewBox height. */
export const MARK_VIEWBOX_H: number = 1000;
/**
 * Outer-group translate x in pixels. The Mappe renderer projects each
 * SVG x as `translateX - x`; setting this to the viewBox width mirrors
 * the path within its own box. Because `MARK_PATH_D` is horizontally
 * symmetric, that mirror leaves the rendered mark unchanged.
 */
export const MARK_TRANSLATE_X: number = 1000;

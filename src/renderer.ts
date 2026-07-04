import { computeHomography, type Point, type Quad } from './homography';

export interface WarpRegion {
  id: string;
  /** ID of the image this region uses */
  imageId: string;
  /** Source rectangle in the image (normalized 0-1 coords) */
  srcRect: { x: number; y: number; w: number; h: number };
  /** Destination quad on the canvas (pixel coords) */
  dstQuad: Quad;
}

export type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface ImageFrame {
  /** Fully composited frame */
  bitmap: ImageBitmap;
  durationMs: number;
}

export interface LoadedImage {
  id: string;
  name: string;
  /** Static content, or the first frame of an animated image */
  element: ImageSource;
  /** Present for animated images (e.g. GIFs); loops forever */
  frames?: ImageFrame[];
  totalDurationMs?: number;
}

/**
 * How far each mesh triangle's clip path is expanded so neighbors overlap,
 * hiding the antialiased-clip seams between them. Device pixels — assumes
 * triangles are rasterized under an identity transform (renderAll guarantees
 * this).
 */
const SEAM_PAD_PX = 0.75;

/** Trace a quad as the current path (no fill/stroke/clip applied). */
export function traceQuadPath(ctx: CanvasRenderingContext2D, quad: Quad): void {
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 1; i < 4; i++) {
    ctx.lineTo(quad[i].x, quad[i].y);
  }
  ctx.closePath();
}

/** Pick the frame to show at the given time (animations loop forever). */
function frameAt(img: LoadedImage, nowMs: number): ImageSource {
  if (!img.frames || img.frames.length < 2 || !img.totalDurationMs) {
    return img.element;
  }
  let t = nowMs % img.totalDurationMs;
  for (const frame of img.frames) {
    if (t < frame.durationMs) return frame.bitmap;
    t -= frame.durationMs;
  }
  return img.element;
}

// Transparency detection, cached per image source. Images with any
// translucent pixel are rendered with exact (non-inflated) triangle clips:
// the inflated clips overlap, and overlapping source-over draws would
// double-blend semi-transparent texels into a visible grid. Opaque images
// (the common case for battle maps) get the inflated clips, which hide the
// antialiased-clip seams completely. There is no canvas-2D compositing mode
// that gives exactly-once coverage for overlapping draws, so translucent
// images keep the (much less visible there) hairline seams instead.
const transparencyCache = new WeakMap<ImageSource, boolean>();
let probeCanvas: HTMLCanvasElement | null = null;

function hasTransparency(image: ImageSource): boolean {
  const cached = transparencyCache.get(image);
  if (cached !== undefined) return cached;

  // Downscale for the scan: bilinear filtering keeps any visually relevant
  // transparent area detectable, and opaque pixels stay fully opaque.
  const w = Math.max(1, Math.min(image.width, 256));
  const h = Math.max(1, Math.min(image.height, 256));
  if (!probeCanvas) probeCanvas = document.createElement('canvas');
  if (probeCanvas.width < w) probeCanvas.width = w;
  if (probeCanvas.height < h) probeCanvas.height = h;
  const pctx = probeCanvas.getContext('2d', { willReadFrequently: true })!;
  pctx.clearRect(0, 0, w, h);
  pctx.drawImage(image, 0, 0, w, h);
  const data = pctx.getImageData(0, 0, w, h).data;
  let translucent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) {
      translucent = true;
      break;
    }
  }
  transparencyCache.set(image, translucent);
  return translucent;
}

/**
 * Renders a warped image region onto a canvas using per-pixel inverse mapping.
 * This is the core projection mapping renderer.
 */
export function renderWarpedRegion(
  ctx: CanvasRenderingContext2D,
  image: ImageSource,
  region: WarpRegion,
  subdivisions = 8
): void {
  // For performance, we use a mesh-based approach: subdivide the unit square
  // into a grid and draw textured triangles for each cell.
  const H = computeHomography(region.dstQuad);
  const { srcRect } = region;

  const imgW = image.width;
  const imgH = image.height;

  // Source pixel rect
  const sx0 = srcRect.x * imgW;
  const sy0 = srcRect.y * imgH;
  const sw = srcRect.w * imgW;
  const sh = srcRect.h * imgH;

  // Create a grid of points in unit-square space and their mapped positions
  const cols = subdivisions;
  const rows = subdivisions;

  const pad = hasTransparency(image) ? 0 : SEAM_PAD_PX;

  // Clip to the exact quad outline so the inflated triangle clips can't
  // bleed past the region's edge. try/finally so a throwing drawImage can't
  // leak the clip onto the shared context.
  ctx.save();
  try {
    traceQuadPath(ctx, region.dstQuad);
    ctx.clip();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Four corners of this grid cell in unit-square space
        const u0 = c / cols,
          v0 = r / rows;
        const u1 = (c + 1) / cols,
          v1 = (r + 1) / rows;

        // Map to destination positions via homography
        const p00 = applyH(H, u0, v0);
        const p10 = applyH(H, u1, v0);
        const p01 = applyH(H, u0, v1);
        const p11 = applyH(H, u1, v1);

        // Source texture coords in pixels
        const tx0 = sx0 + u0 * sw,
          ty0 = sy0 + v0 * sh;
        const tx1 = sx0 + u1 * sw,
          ty1 = sy0 + v1 * sh;

        // Draw two triangles per cell
        drawTexturedTriangle(
          ctx,
          image,
          pad,
          // dst triangle
          p00.x, p00.y, p10.x, p10.y, p01.x, p01.y,
          // src triangle (texture coords)
          tx0, ty0, tx1, ty0, tx0, ty1
        );
        drawTexturedTriangle(
          ctx,
          image,
          pad,
          p10.x, p10.y, p11.x, p11.y, p01.x, p01.y,
          tx1, ty0, tx1, ty1, tx0, ty1
        );
      }
    }
  } finally {
    ctx.restore();
  }
}

function applyH(H: number[], x: number, y: number): Point {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
}

/**
 * Offset every edge of a triangle outward by `d` pixels (perpendicular to
 * the edge) and return the triangle formed by the offset edges'
 * intersections. Vertex displacement is capped so near-degenerate triangles
 * can't shoot vertices far away; on fully degenerate input the original
 * points are returned.
 */
function inflateTriangle(pts: [Point, Point, Point], d: number): [Point, Point, Point] {
  const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
  const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;

  // Offset edge lines in normal form: nx*x + ny*y = c, normal pointing outward
  const lines: [number, number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 3];
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const len = Math.hypot(nx, ny);
    if (len < 1e-9) return pts;
    nx /= len;
    ny /= len;
    if (nx * (cx - a.x) + ny * (cy - a.y) > 0) {
      nx = -nx;
      ny = -ny;
    }
    lines.push([nx, ny, nx * a.x + ny * a.y + d]);
  }

  const out: Point[] = [];
  for (let i = 0; i < 3; i++) {
    // New vertex i sits at the intersection of its two adjacent offset edges
    const [n1x, n1y, c1] = lines[(i + 2) % 3];
    const [n2x, n2y, c2] = lines[i];
    const det = n1x * n2y - n1y * n2x;
    if (Math.abs(det) < 1e-9) return pts;
    let x = (c1 * n2y - c2 * n1y) / det;
    let y = (n1x * c2 - n2x * c1) / det;
    // Cap displacement for very acute corners
    const shift = Math.hypot(x - pts[i].x, y - pts[i].y);
    const maxShift = d * 8;
    if (shift > maxShift) {
      x = pts[i].x + ((x - pts[i].x) / shift) * maxShift;
      y = pts[i].y + ((y - pts[i].y) / shift) * maxShift;
    }
    out.push({ x, y });
  }
  return out as [Point, Point, Point];
}

/**
 * Draw a textured triangle using canvas affine transform.
 * Maps src triangle from the image to dst triangle on the canvas.
 */
function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: ImageSource,
  // clip inflation in px (SEAM_PAD_PX for opaque images, 0 for translucent)
  pad: number,
  // destination triangle
  dx0: number, dy0: number,
  dx1: number, dy1: number,
  dx2: number, dy2: number,
  // source triangle (texture coords in pixels)
  sx0: number, sy0: number,
  sx1: number, sy1: number,
  sx2: number, sy2: number
): void {
  // Skip (near-)zero-area destination triangles: the affine solve below is
  // near-singular for them and would smear far-away texels into the inflated
  // clip band. Before the seam fix these slivers clipped to nothing, which
  // is also the right look.
  const dstArea2 =
    (dx1 - dx0) * (dy2 - dy0) - (dy1 - dy0) * (dx2 - dx0);
  if (Math.abs(dstArea2) < 1e-2) return;

  ctx.save();

  // Clip to the destination triangle, inflated so adjacent triangles overlap
  // by a hair. Without this, antialiased clip edges leave visible seams
  // between triangles. The texture transform below still uses the original
  // coordinates, so the wider clip just reveals the neighboring texels of
  // the same image (the caller's quad clip bounds the overall bleed).
  const src: [Point, Point, Point] = [
    { x: dx0, y: dy0 }, { x: dx1, y: dy1 }, { x: dx2, y: dy2 },
  ];
  const t = pad > 0 ? inflateTriangle(src, pad) : src;
  ctx.beginPath();
  ctx.moveTo(t[0].x, t[0].y);
  ctx.lineTo(t[1].x, t[1].y);
  ctx.lineTo(t[2].x, t[2].y);
  ctx.closePath();
  ctx.clip();

  // Compute affine transform that maps src triangle -> dst triangle
  // src: (sx0,sy0) -> (dx0,dy0), (sx1,sy1) -> (dx1,dy1), (sx2,sy2) -> (dx2,dy2)
  //
  // We need M such that M * [sx, sy, 1]^T = [dx, dy]
  // This gives us the canvas transform to apply before drawImage

  const denom = (sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1));
  if (Math.abs(denom) < 1e-10) {
    ctx.restore();
    return;
  }

  const invDenom = 1 / denom;

  // Transform matrix components [a, b, c, d, e, f] for ctx.setTransform
  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) * invDenom;
  const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) * invDenom;
  const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) * invDenom;
  const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) * invDenom;
  const e =
    (dx0 * (sx1 * sy2 - sx2 * sy1) +
      dx1 * (sx2 * sy0 - sx0 * sy2) +
      dx2 * (sx0 * sy1 - sx1 * sy0)) * invDenom;
  const f =
    (dy0 * (sx1 * sy2 - sx2 * sy1) +
      dy1 * (sx2 * sy0 - sx0 * sy2) +
      dy2 * (sx0 * sy1 - sx1 * sy0)) * invDenom;

  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * Render all warp regions onto the canvas, looking up each region's image.
 * Animated images show the frame matching `nowMs`.
 * Returns true if any rendered region is animated (i.e. keep rendering).
 */
export function renderAll(
  ctx: CanvasRenderingContext2D,
  images: Map<string, LoadedImage>,
  regions: WarpRegion[],
  nowMs = performance.now(),
  clearColor = '#111'
): boolean {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = clearColor;
  ctx.fillRect(0, 0, width, height);

  let animating = false;
  for (const region of regions) {
    const img = images.get(region.imageId);
    if (img) {
      renderWarpedRegion(ctx, frameAt(img, nowMs), region);
      if (img.frames && img.frames.length > 1) animating = true;
    }
  }
  return animating;
}

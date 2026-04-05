import { computeHomography, type Point, type Quad } from './homography';

export interface WarpRegion {
  id: string;
  /** Source rectangle in the image (normalized 0-1 coords) */
  srcRect: { x: number; y: number; w: number; h: number };
  /** Destination quad on the canvas (pixel coords) */
  dstQuad: Quad;
}

/**
 * Renders a warped image region onto a canvas using per-pixel inverse mapping.
 * This is the core projection mapping renderer.
 */
export function renderWarpedRegion(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | HTMLCanvasElement,
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
        // dst triangle
        p00.x, p00.y, p10.x, p10.y, p01.x, p01.y,
        // src triangle (texture coords)
        tx0, ty0, tx1, ty0, tx0, ty1
      );
      drawTexturedTriangle(
        ctx,
        image,
        p10.x, p10.y, p11.x, p11.y, p01.x, p01.y,
        tx1, ty0, tx1, ty1, tx0, ty1
      );
    }
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
 * Draw a textured triangle using canvas affine transform.
 * Maps src triangle from the image to dst triangle on the canvas.
 */
function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  // destination triangle
  dx0: number, dy0: number,
  dx1: number, dy1: number,
  dx2: number, dy2: number,
  // source triangle (texture coords in pixels)
  sx0: number, sy0: number,
  sx1: number, sy1: number,
  sx2: number, sy2: number
): void {
  ctx.save();

  // Clip to the destination triangle
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
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
 * Render all warp regions onto the canvas.
 */
export function renderAll(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | HTMLCanvasElement,
  regions: WarpRegion[],
  clearColor = '#111'
): void {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = clearColor;
  ctx.fillRect(0, 0, width, height);

  for (const region of regions) {
    renderWarpedRegion(ctx, image, region);
  }
}

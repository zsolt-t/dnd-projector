/**
 * Computes a 3x3 perspective homography matrix that maps a unit square
 * [(0,0), (1,0), (1,1), (0,1)] to an arbitrary quadrilateral defined
 * by four destination corners.
 *
 * Uses the DLT (Direct Linear Transform) algorithm.
 * Returns the 3x3 matrix as a flat 9-element array (row-major).
 */

export interface Point {
  x: number;
  y: number;
}

export type Quad = [Point, Point, Point, Point]; // TL, TR, BR, BL

/**
 * Solve an 8x8 linear system Ax = b using Gaussian elimination.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  // Augmented matrix
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) throw new Error('Singular matrix');

    for (let j = col; j <= n; j++) aug[col][j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row[n]);
}

/**
 * Compute the 3x3 homography matrix mapping unit square to dst quad.
 *
 * src corners (unit square): (0,0) (1,0) (1,1) (0,1)
 * dst corners: quad[0..3] in same order (TL, TR, BR, BL)
 */
export function computeHomography(dst: Quad): number[] {
  const src: Quad = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  // Build the 8x8 system for DLT
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x,
      sy = src[i].y;
    const dx = dst[i].x,
      dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  const h = solveLinearSystem(A, b);

  // h = [h0..h7], h8 = 1
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * Apply a 3x3 homography to a point: (x,y) -> (x',y')
 */
export function applyHomography(H: number[], p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

/**
 * Invert a 3x3 matrix (flat row-major array of 9 elements).
 */
export function invertHomography(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error('Singular homography');
  const invDet = 1 / det;
  return [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
}

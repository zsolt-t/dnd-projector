import type { Point, Quad } from './homography';
import type { WarpRegion } from './renderer';

const HANDLE_RADIUS = 8;
const HANDLE_HIT_RADIUS = 16;

export interface QuadEditorState {
  regions: WarpRegion[];
  selectedRegionId: string | null;
  dragInfo: {
    regionId: string;
    cornerIndex: number;
  } | null;
}

export function createDefaultRegion(
  bounds: { x: number; y: number; w: number; h: number },
  imageId: string
): WarpRegion {
  const margin = Math.min(bounds.w, bounds.h) * 0.1;
  return {
    id: crypto.randomUUID(),
    imageId,
    srcRect: { x: 0, y: 0, w: 1, h: 1 },
    dstQuad: [
      { x: bounds.x + margin, y: bounds.y + margin },
      { x: bounds.x + bounds.w - margin, y: bounds.y + margin },
      { x: bounds.x + bounds.w - margin, y: bounds.y + bounds.h - margin },
      { x: bounds.x + margin, y: bounds.y + bounds.h - margin },
    ],
  };
}

export function createEditorState(): QuadEditorState {
  return {
    regions: [],
    selectedRegionId: null,
    dragInfo: null,
  };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Find which corner handle (if any) is under the given point.
 */
function hitTestCorner(
  regions: WarpRegion[],
  p: Point
): { regionId: string; cornerIndex: number } | null {
  // Check all regions, preferring the selected one
  for (const region of regions) {
    for (let i = 0; i < 4; i++) {
      if (dist(p, region.dstQuad[i]) < HANDLE_HIT_RADIUS) {
        return { regionId: region.id, cornerIndex: i };
      }
    }
  }
  return null;
}

/**
 * Test if a point is inside a quad (using cross-product winding).
 */
function pointInQuad(p: Point, quad: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross < 0) return false;
  }
  return true;
}

export function handlePointerDown(
  state: QuadEditorState,
  canvasPoint: Point
): boolean {
  const hit = hitTestCorner(state.regions, canvasPoint);
  if (hit) {
    state.dragInfo = hit;
    state.selectedRegionId = hit.regionId;
    return true;
  }

  // Check if clicking inside a quad to select it
  for (const region of state.regions) {
    if (pointInQuad(canvasPoint, region.dstQuad)) {
      state.selectedRegionId = region.id;
      return true;
    }
  }

  state.selectedRegionId = null;
  return false;
}

export function handlePointerMove(
  state: QuadEditorState,
  canvasPoint: Point
): boolean {
  if (!state.dragInfo) return false;

  const region = state.regions.find((r) => r.id === state.dragInfo!.regionId);
  if (!region) return false;

  region.dstQuad[state.dragInfo.cornerIndex] = { ...canvasPoint };
  return true;
}

export function handlePointerUp(state: QuadEditorState): void {
  state.dragInfo = null;
}

/**
 * Draw editor overlays: quad outlines and corner handles.
 */
export function drawEditorOverlay(
  ctx: CanvasRenderingContext2D,
  state: QuadEditorState
): void {
  for (const region of state.regions) {
    const isSelected = region.id === state.selectedRegionId;
    const quad = region.dstQuad;

    // Draw quad outline
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    for (let i = 1; i < 4; i++) {
      ctx.lineTo(quad[i].x, quad[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = isSelected ? '#00ff88' : '#ffffff88';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    // Draw corner handles
    for (let i = 0; i < 4; i++) {
      const corner = quad[i];
      ctx.beginPath();
      ctx.arc(corner.x, corner.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#00ff88' : '#ffffffaa';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label corners
      ctx.fillStyle = '#000';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(['TL', 'TR', 'BR', 'BL'][i], corner.x, corner.y);
    }
  }
}

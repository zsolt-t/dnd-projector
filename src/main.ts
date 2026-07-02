import { renderAll, type LoadedImage } from './renderer';
import {
  createDefaultRegion,
  createEditorState,
  drawEditorOverlay,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
} from './quad-editor';
import './style.css';

const app = document.getElementById('app')!;

app.innerHTML = `
  <div class="toolbar">
    <button id="btn-load">Load Image(s)</button>
    <button id="btn-add-region" disabled>Add Region</button>
    <button id="btn-remove-region" disabled>Remove Region</button>
    <span class="separator"></span>
    <label class="toolbar-label">Image:
      <select id="sel-image" disabled></select>
    </label>
    <span class="separator"></span>
    <button id="btn-fullscreen" title="Press V to show/hide handles for fine-tuning">Fullscreen Preview</button>
    <input type="file" id="file-input" accept="image/*" multiple hidden />
    <span id="status">No images loaded</span>
  </div>
  <div class="workspace">
    <canvas id="canvas"></canvas>
  </div>
`;

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const btnLoad = document.getElementById('btn-load') as HTMLButtonElement;
const btnAddRegion = document.getElementById('btn-add-region') as HTMLButtonElement;
const btnRemoveRegion = document.getElementById('btn-remove-region') as HTMLButtonElement;
const btnFullscreen = document.getElementById('btn-fullscreen') as HTMLButtonElement;
const selImage = document.getElementById('sel-image') as HTMLSelectElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

const images = new Map<string, LoadedImage>();
let showOverlay = true;

const editorState = createEditorState();

// --- Canvas sizing & stage ---
// The "stage" is the part of the canvas that represents the physical screen.
// In the workspace it's a letterboxed rect with the screen's aspect ratio;
// in fullscreen it's the whole screen. Quad corners are stored in canvas
// pixels, so on any stage change they're remapped relative to the stage.
// Because the stage aspect ratio never changes, that mapping is uniform.
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let stage: Rect = { x: 0, y: 0, w: 0, h: 0 };

// Predicted from screen.*, then corrected with the measured viewport once
// fullscreen is entered (display scaling can make the two disagree).
let screenAspect = screen.width / screen.height;

function workspaceStage(canvasW: number, canvasH: number): Rect {
  const margin = 16;
  let w = canvasW - margin * 2;
  let h = w / screenAspect;
  if (h > canvasH - margin * 2) {
    h = canvasH - margin * 2;
    w = h * screenAspect;
  }
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}

function setStage(canvasW: number, canvasH: number, next: Rect) {
  if (stage.w > 0 && stage.h > 0) {
    const sx = next.w / stage.w;
    const sy = next.h / stage.h;
    for (const region of editorState.regions) {
      for (const corner of region.dstQuad) {
        corner.x = next.x + (corner.x - stage.x) * sx;
        corner.y = next.y + (corner.y - stage.y) * sy;
      }
    }
  }
  stage = next;
  canvas.width = canvasW;
  canvas.height = canvasH;
  requestRender();
}

// Size the canvas bitmap to the element's actual rendered size. In
// fullscreen the whole canvas is the stage; in the workspace the stage is
// the letterboxed screen-aspect rect. The ResizeObserver fires on window
// resizes and on fullscreen enter/exit, always with measured dimensions —
// never sizes predicted from screen.*, which display scaling can falsify.
function resizeCanvas() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  if (document.fullscreenElement === canvas) {
    screenAspect = w / h;
    setStage(w, h, { x: 0, y: 0, w, h });
  } else {
    setStage(w, h, workspaceStage(w, h));
  }
}
new ResizeObserver(resizeCanvas).observe(canvas);

// --- Render loop ---
// Renders on demand, but keeps a continuous rAF loop alive while any
// visible region shows an animated image.
let renderQueued = false;

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function render(nowMs: number) {
  renderQueued = false;
  let animating = false;
  if (images.size > 0) {
    animating = renderAll(ctx, images, editorState.regions, nowMs);
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#555';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Load an image to get started', canvas.width / 2, canvas.height / 2);
  }

  if (showOverlay) {
    // Stage outline: everything inside maps 1:1 onto the screen in fullscreen
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = '#555';
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(stage.x, stage.y, stage.w, stage.h);
    ctx.setLineDash([]);
    drawEditorOverlay(ctx, editorState);
  }

  if (animating) requestRender();
}

// --- Image library ---
function rebuildImageSelect() {
  const selectedRegion = editorState.regions.find(
    (r) => r.id === editorState.selectedRegionId
  );
  const currentImageId = selectedRegion?.imageId;

  selImage.innerHTML = '';
  for (const img of images.values()) {
    const opt = document.createElement('option');
    opt.value = img.id;
    opt.textContent = img.name;
    if (img.id === currentImageId) opt.selected = true;
    selImage.appendChild(opt);
  }

  selImage.disabled = images.size === 0 || !selectedRegion;
  btnAddRegion.disabled = images.size === 0;
}

function updateStatus() {
  const count = images.size;
  statusEl.textContent = count === 0
    ? 'No images loaded'
    : `${count} image${count > 1 ? 's' : ''} loaded`;
}

// When the image dropdown changes, update the selected region's imageId
selImage.addEventListener('change', () => {
  const selectedRegion = editorState.regions.find(
    (r) => r.id === editorState.selectedRegionId
  );
  if (selectedRegion) {
    selectedRegion.imageId = selImage.value;
    requestRender();
  }
});

// --- Image loading ---
btnLoad.addEventListener('click', () => fileInput.click());

/**
 * Decode an animated GIF into fully composited frames via the WebCodecs
 * ImageDecoder API. Returns null for static GIFs or unsupported browsers
 * (the caller falls back to static loading).
 */
async function decodeAnimatedGif(
  file: File
): Promise<Pick<LoadedImage, 'element' | 'frames' | 'totalDurationMs'> | null> {
  if (typeof ImageDecoder === 'undefined') return null;
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track || !track.animated || track.frameCount < 2) return null;

    const frames = [];
    let totalDurationMs = 0;
    for (let i = 0; i < track.frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      const rawMs = (image.duration ?? 0) / 1000;
      // Browsers treat near-zero GIF frame delays as 100ms
      const durationMs = rawMs < 20 ? 100 : rawMs;
      frames.push({ bitmap: await createImageBitmap(image), durationMs });
      totalDurationMs += durationMs;
      image.close();
    }
    return { element: frames[0].bitmap, frames, totalDurationMs };
  } finally {
    decoder.close();
  }
}

function loadStaticImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function loadImageFile(file: File): Promise<LoadedImage> {
  const id = crypto.randomUUID();
  if (file.type === 'image/gif') {
    try {
      const gif = await decodeAnimatedGif(file);
      if (gif) return { id, name: file.name, ...gif };
    } catch {
      // fall through to static loading
    }
  }
  return { id, name: file.name, element: await loadStaticImage(file) };
}

fileInput.addEventListener('change', async () => {
  const files = fileInput.files;
  if (!files || files.length === 0) return;
  const selected = [...files];
  // Reset so the same file(s) can be re-selected
  fileInput.value = '';

  for (const file of selected) {
    try {
      const loaded = await loadImageFile(file);
      images.set(loaded.id, loaded);

      // Auto-create a region for the first image loaded if none exist
      if (editorState.regions.length === 0) {
        const region = createDefaultRegion(stage, loaded.id);
        editorState.regions.push(region);
        editorState.selectedRegionId = region.id;
      }
    } catch {
      console.warn(`Failed to load ${file.name}`);
    }
  }

  updateStatus();
  updateUI();
  requestRender();
});

// --- Region management ---
btnAddRegion.addEventListener('click', () => {
  // Use the currently selected image in the dropdown, or the first available
  const imageId = selImage.value || images.keys().next().value;
  if (!imageId) return;

  const region = createDefaultRegion(stage, imageId);
  const offset = editorState.regions.length * 20;
  for (const corner of region.dstQuad) {
    corner.x += offset;
    corner.y += offset;
  }
  editorState.regions.push(region);
  editorState.selectedRegionId = region.id;
  updateUI();
  requestRender();
});

btnRemoveRegion.addEventListener('click', () => {
  if (!editorState.selectedRegionId) return;
  editorState.regions = editorState.regions.filter(
    (r) => r.id !== editorState.selectedRegionId
  );
  editorState.selectedRegionId = editorState.regions[0]?.id ?? null;
  updateUI();
  requestRender();
});

function updateUI() {
  btnRemoveRegion.disabled = !editorState.selectedRegionId;
  rebuildImageSelect();
}

// --- Fullscreen ---
btnFullscreen.addEventListener('click', () => {
  showOverlay = false;
  requestRender();
  canvas.requestFullscreen().catch(() => {
    showOverlay = true;
    requestRender();
  });
});

document.addEventListener('fullscreenchange', () => {
  showOverlay = !document.fullscreenElement;
  resizeCanvas();
});

// --- Pointer interaction ---
// Clamped to the stage so dragged corners can't leave the projected area
// (pointer capture keeps drags alive even when the pointer exits the canvas).
function getCanvasPoint(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.min(Math.max(e.clientX - rect.left, stage.x), stage.x + stage.w),
    y: Math.min(Math.max(e.clientY - rect.top, stage.y), stage.y + stage.h),
  };
}

canvas.addEventListener('pointerdown', (e) => {
  const p = getCanvasPoint(e);
  if (handlePointerDown(editorState, p)) {
    canvas.setPointerCapture(e.pointerId);
    updateUI();
    requestRender();
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = getCanvasPoint(e);
  if (handlePointerMove(editorState, p)) {
    requestRender();
  }
});

canvas.addEventListener('pointerup', () => {
  handlePointerUp(editorState);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.fullscreenElement) {
    document.exitFullscreen();
  } else if (e.key === 'v' || e.key === 'V') {
    if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
    showOverlay = !showOverlay;
    requestRender();
  }
});

// --- Init ---
resizeCanvas();

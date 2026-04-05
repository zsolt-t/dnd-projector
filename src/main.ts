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
    <button id="btn-fullscreen">Fullscreen Preview</button>
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

// --- Canvas sizing ---
function resizeCanvas() {
  const workspace = canvas.parentElement!;
  canvas.width = workspace.clientWidth;
  canvas.height = workspace.clientHeight;
  requestRender();
}
window.addEventListener('resize', resizeCanvas);

// --- Render loop ---
function requestRender() {
  requestAnimationFrame(render);
}

function render() {
  if (images.size > 0) {
    renderAll(ctx, images, editorState.regions);
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
    drawEditorOverlay(ctx, editorState);
  }
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

fileInput.addEventListener('change', () => {
  const files = fileInput.files;
  if (!files || files.length === 0) return;

  let firstImageId: string | null = null;

  for (const file of files) {
    const img = new Image();
    const id = crypto.randomUUID();
    if (!firstImageId) firstImageId = id;

    img.onload = () => {
      images.set(id, { id, name: file.name, element: img });
      rebuildImageSelect();
      updateStatus();

      // Auto-create a region for the first image loaded if none exist
      if (editorState.regions.length === 0) {
        const region = createDefaultRegion(canvas.width, canvas.height, id);
        editorState.regions.push(region);
        editorState.selectedRegionId = region.id;
        updateUI();
      }

      requestRender();
    };
    img.src = URL.createObjectURL(file);
  }

  // Reset so the same file(s) can be re-selected
  fileInput.value = '';
});

// --- Region management ---
btnAddRegion.addEventListener('click', () => {
  // Use the currently selected image in the dropdown, or the first available
  const imageId = selImage.value || images.keys().next().value;
  if (!imageId) return;

  const region = createDefaultRegion(canvas.width, canvas.height, imageId);
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
  if (!document.fullscreenElement) {
    showOverlay = true;
    resizeCanvas();
  } else {
    canvas.width = screen.width;
    canvas.height = screen.height;
    requestRender();
  }
});

// --- Pointer interaction ---
function getCanvasPoint(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
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
  }
});

// --- Init ---
resizeCanvas();

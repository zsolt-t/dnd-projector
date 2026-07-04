# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DnD Projector — a projection mapping tool for tabletop gaming. Users load images (e.g. D&D battle maps) and define quadrilateral regions that perspective-warp the content onto physical surfaces (e.g. faces of a cube on a table).

## Commands

- `npm run dev` — start Vite dev server with HMR
- `npm run build` — type-check with `tsc` then bundle with Vite
- `npm run preview` — serve the production build locally
- `npx tsc --noEmit` — type-check only (no build)

## Architecture

**Vanilla TypeScript + Vite** (no framework). Single-page app with a toolbar and a full-viewport canvas.

### Core modules (all in `src/`)

- **`homography.ts`** — Linear algebra for perspective transforms. Computes 3x3 homography matrices mapping a unit square to an arbitrary quad (DLT algorithm). Also provides matrix inversion and point projection.

- **`renderer.ts`** — Canvas 2D rendering engine. Defines `WarpRegion` and `LoadedImage`. `renderAll` takes the image library (`Map<string, LoadedImage>`) and a list of regions, looking up each region's image by `imageId`. Renders via mesh subdivision: each quad is divided into a grid of sub-quads, each drawn as two affine-textured triangles.

- **`quad-editor.ts`** — Interactive editor state and UI. Manages selection, hit-testing, and dragging of quad corner handles. Draws overlays (outlines, labeled corner handles). The editor state is a plain object — no classes, no framework.

- **`main.ts`** — Wires everything together: DOM setup, multi-image file loading into the image library, per-region image assignment via a toolbar dropdown, pointer event handling, fullscreen toggle, canvas resize. Owns the **stage**: a rect on the canvas representing the physical screen (letterboxed at the screen's aspect ratio in the workspace, the full screen in fullscreen). Quad corners are canvas pixels; on stage changes they're remapped uniformly relative to the stage, and pointer input is clamped to it.

### Key data types

- `Quad` = 4 `Point`s in order: TL, TR, BR, BL
- `WarpRegion` = `{ id, imageId, srcRect (normalized 0-1), dstQuad (canvas pixels) }`
- `LoadedImage` = `{ id, name, element, frames?, totalDurationMs? }` — images are stored in a `Map` keyed by `id`; each region references one via `imageId`. Animated GIFs are pre-decoded (WebCodecs `ImageDecoder`) into composited `ImageBitmap` frames; `renderAll(…, nowMs)` picks the frame by time and returns whether anything is animating, which keeps main.ts's rAF loop running (otherwise rendering is on-demand).

### Rendering approach

The perspective warp uses a mesh-based approximation: the unit square is subdivided into an NxN grid, homography maps each vertex to canvas space, and each cell is drawn as two canvas-clipped affine-textured triangles. This avoids WebGL while giving acceptable quality at ~8 subdivisions.

To hide the antialiased-clip seams between triangles, each triangle's clip path is inflated by `SEAM_PAD_PX` so neighbors overlap (bounded by an outer clip to the exact quad). Overlapping source-over draws would double-blend semi-transparent texels into a visible grid, so images containing transparency (detected once per image source, cached in a WeakMap) are rendered with exact clips instead — alpha-correct, at the cost of keeping the hairline seams that are much less visible on translucent content. No canvas-2D composite mode provides exactly-once coverage for overlapping draws (`'copy'` replaces rather than blends at antialiased clip edges), which is why the split exists.

### PWA & deployment

The app is a PWA (`vite-plugin-pwa` in `vite.config.ts`): the build precaches all assets, and `base: './'` keeps it working on a subpath or from `file://`. Updates are **prompt-based** — when a new deploy is detected, main.ts shows an "Update ready" toolbar button instead of auto-reloading, because all state (image library, quad calibration) is in-memory only. Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml` (Pages source must be set to "GitHub Actions" in repo settings, one-time). Live at <https://zsolt-t.github.io/dnd-projector/>.

User-facing usage docs live in [README.md](README.md) — keep it in sync when toolbar controls or keyboard shortcuts change.

## TypeScript

Strict mode is on. `noUnusedLocals` and `noUnusedParameters` are enabled — unused imports will fail the build.

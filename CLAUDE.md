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

- **`renderer.ts`** — Canvas 2D rendering engine. Takes an image and a list of `WarpRegion`s (each has a source rect in normalized image coords and a destination quad in canvas pixels). Renders via mesh subdivision: each quad is divided into a grid of sub-quads, each drawn as two affine-textured triangles.

- **`quad-editor.ts`** — Interactive editor state and UI. Manages selection, hit-testing, and dragging of quad corner handles. Draws overlays (outlines, labeled corner handles). The editor state is a plain object — no classes, no framework.

- **`main.ts`** — Wires everything together: DOM setup, image file loading, pointer event handling, fullscreen toggle, canvas resize.

### Key data types

- `Quad` = 4 `Point`s in order: TL, TR, BR, BL
- `WarpRegion` = `{ id, srcRect (normalized 0-1), dstQuad (canvas pixels) }`

### Rendering approach

The perspective warp uses a mesh-based approximation: the unit square is subdivided into an NxN grid, homography maps each vertex to canvas space, and each cell is drawn as two canvas-clipped affine-textured triangles. This avoids WebGL while giving acceptable quality at ~8 subdivisions.

## TypeScript

Strict mode is on. `noUnusedLocals` and `noUnusedParameters` are enabled — unused imports will fail the build.

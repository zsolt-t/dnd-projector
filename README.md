# DnD Projector

Projection mapping for tabletop gaming. Load battle maps (or any images), define quadrilateral regions, and perspective-warp them onto physical surfaces — the faces of a terrain cube, a tilted board, the table itself. Point a projector at the table, drag the corners until the image lands where you want it, and play.

**Live app:** <https://zsolt-t.github.io/dnd-projector/> — installable as a PWA and works offline after the first visit. No accounts, no servers: images never leave your machine.

## Usage

1. **Load Image(s)** — pick one or more images. JPG/PNG plus animated GIFs (frames are pre-decoded and play in a loop).
2. **Add Region** — creates a warp quad. Each region can show a different image, chosen from the **Image** dropdown while the region is selected.
3. **Drag the corner handles** (TL/TR/BR/BL) so the image covers the physical surface. Click inside a quad to select it.
4. **Fullscreen Preview** — send the canvas fullscreen on the projector display. The dashed rectangle in the workspace (the *stage*) maps 1:1 onto the screen in fullscreen, so what you line up is what gets projected.

| Key | Action |
|---|---|
| `V` | Show/hide the corner handles and outlines (works in fullscreen, for fine-tuning against the real surface) |
| `Esc` | Exit fullscreen |

Session state (loaded images, quad positions) lives in memory only — a reload starts fresh. When a new version is deployed, an **Update ready** button appears in the toolbar instead of the app reloading on its own, so an update can never interrupt a running game.

## Development

Vanilla TypeScript + Vite, no framework, no WebGL — the perspective warp is a mesh of affine-textured canvas triangles (see [CLAUDE.md](CLAUDE.md) for architecture notes).

```sh
npm install
npm run dev       # dev server with HMR
npm run build     # type-check + production bundle
npm run preview   # serve the production build locally
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`. The build uses relative asset paths (`base: './'`), so `dist/` also works from a subpath or straight off a USB stick via `file://`.

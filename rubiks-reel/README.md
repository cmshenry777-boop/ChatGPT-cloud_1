# RUBIK'S CUBE — BY THE NUMBERS

A 15-second vertical (9:16) motion-design reel that explains the Rubik's Cube,
built entirely in code: real-time 3D, kinetic typography and a synthesized,
picture-locked soundtrack. **1080×1920 · 60 fps · 15.00 s · H.264 + AAC.**

→ `dist/rubiks_cube_reel.mp4`

## The story — six numbers, six beats

| # | Time | Number | Beat |
|---|------|--------|------|
| 01 | 0.0–2.0 | **54** | 26 pieces streak in and snap together. *54개의 칸, 6가지 색, 정답은 단 하나.* |
| 02 | 2.0–5.0 | **6 + 12 + 8 = 26** | Exploded technical drawing on paper: centers (fixed axes), edges (2 colours), corners (3 colours) — plus the core spider. |
| 03 | 5.0–8.0 | **R U R′ U′** | Notation taught on the beat with direction arrows, then 16 accelerating moves scramble the cube into the drop. |
| 04 | 8.0–11.0 | **43,252,003,274,489,856,000** | The camera pulls back: the cube is one cell of an isometric honeycomb of scrambled cubes. 1.4 trillion years at one state per second. |
| 05 | 11.0–13.5 | **20** | God's number. The cube solves itself in exactly 20 moves on 16th notes; the counter hits 20 as the last turn lands. |
| 06 | 13.5–15.0 | — | Solved. *혼돈 속에도, 해법은 있다.* |

The 20 moves are real: `R U R′ U′` + 16 random moves form the scramble, and
scene 05 plays its exact inverse — so the counter and the cube can never disagree.

## Design system

- **Type** — Archivo (variable, 125% width / 900) for numbers and display,
  Pretendard for Korean, JetBrains Mono for the HUD and figure labels.
- **Colour** — ink `#0C0C0E`, paper `#EEEAE2`, signal yellow `#FFD400`; the six
  sticker colours double as the category code (center = blue, edge = red, corner = green).
- **Transitions** borrow the cube's own mechanics: sticker-grid wipes, and
  three-slab wipes that slide like layer turns (U/E/D horizontally, L/M/R vertically).
- **Motion** — an isometric camera throughout, so in scene 04 cube silhouettes become
  regular hexagons and tile perfectly. 4–12 sub-frame samples per frame give
  true motion blur, and their sub-pixel jitter doubles as anti-aliasing.
- **Sound** — 120 BPM in A minor, resolving to A major on the solve. Every clack,
  snap and digit tick is generated from the picture's cue sheet; the 20 solve
  moves play a marimba scale that lands on the tonic at move 20.

## Build

Requirements: Node 18+, Python 3 with `numpy` + `scipy`, `ffmpeg`, and a Playwright
Chromium (rendering uses WebGL via SwiftShader, so no GPU is needed).

```bash
npm install
pip install numpy scipy
./build.sh                         # cues → audio → frames → dist/rubiks_cube_reel.mp4
node render.mjs --stills 9.4,12.4  # preview individual moments → out/stills/
```

Open `index.html` through any static server to watch a live (unblurred) preview,
or add `?t=9.4` to freeze on a moment.

| File | Role |
|------|------|
| `src/timeline.js` | Scene timing, move schedules, the 20-move scramble / solve |
| `src/cube.js` | Cube model: notation, quarter turns, sticker colours |
| `src/scene3d.js` | Three.js scene, procedural studio shading, honeycomb wall, motion-blur accumulation |
| `src/overlay.js` | Typography, rolling digits, callouts, wipes, HUD |
| `render.mjs` | Deterministic frame renderer (headless Chromium) |
| `audio/synth.py` | Soundtrack synthesis from the cue sheet |

Every frame is a pure function of time, so any frame can be re-rendered on its own.

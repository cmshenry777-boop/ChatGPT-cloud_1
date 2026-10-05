import { render3D, cubies, project, worldFacing, highlight } from './scene3d.js';
import { updateOverlay } from './overlay.js';
import { DURATION, FPS, MAIN_SCHEDULE, S, BEAT } from './timeline.js';

// Motion-blur sample budget per moment (more where things move fast).
function samplesAt(t) {
  if (t < 1.2) return 10;                 // pieces streak in
  if (t > 1.45 && t < 2.1) return 8;      // punctuation spin
  if (t > 2.0 && t < 2.5) return 6;       // explode
  if (t > 4.6 && t < 5.2) return 8;       // implode + spin
  if (t > 5.15 && t < 7.05) return 6;     // deliberate turns
  if (t > 7.0 && t < 9.4) return 12;      // scramble + pull-back
  if (t > 10.3 && t < 11.1) return 12;    // implosion
  if (t > 11.0 && t < 13.6) return 8;     // the solve
  if (t > 13.45 && t < 14.5) return 10;   // victory spin
  return 4;
}

function piecesFor(t) {
  const out = {};
  for (const g of ['center', 'edge', 'corner']) {
    if (highlight(g, t) <= 0) continue;
    let best = null, by = -1;
    for (const c of cubies) {
      if (c.type !== g) continue;
      if (worldFacing(c.g) < 0.25) continue;
      const p = project(c.g);
      if (p.y > by + 4) { by = p.y; best = p; }
    }
    out[g] = best;
  }
  return out;
}

export function renderAt(t, opts = {}) {
  const samples = opts.samples ?? samplesAt(t);
  render3D(t, samples, opts.shutter ?? 0.55, FPS);
  updateOverlay(t, { pieces: piecesFor(t) });
}

// Cue sheet for the sound design (every audible event is tied to the picture).
function cues() {
  const ev = [];
  for (const c of cubies) if (c.type !== 'core') ev.push({ t: c.land, k: 'snap', type: c.type });
  for (const s of MAIN_SCHEDULE) ev.push({ t: s.t1, k: 'turn', kind: s.kind, idx: s.idx, dur: s.t1 - s.t0, t0: s.t0 });
  return { scenes: S, beat: BEAT, duration: DURATION, events: ev.sort((a, b) => a.t - b.t) };
}

window.REEL = { DURATION, FPS, renderAt, cues, ready: document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(r))) };

// Live preview when opened in a normal browser: ?t=7.2 to freeze, otherwise loop.
const q = new URLSearchParams(location.search);
if (!navigator.webdriver) {
  if (q.has('t')) window.REEL.ready.then(() => renderAt(+q.get('t')));
  else {
    const t0 = performance.now();
    const loop = () => { renderAt(((performance.now() - t0) / 1000) % DURATION, { samples: 1 }); requestAnimationFrame(loop); };
    window.REEL.ready.then(loop);
  }
}

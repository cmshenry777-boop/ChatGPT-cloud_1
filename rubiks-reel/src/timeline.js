import { E } from './util.js';
import { parseMove, invertName, scramble } from './cube.js';

// 15.000 s at 120 BPM (one beat = 0.5 s). Scene edges sit on the beat grid.
export const BPM = 120;
export const BEAT = 60 / BPM;
export const DURATION = 15;
export const FPS = 60;

export const S = {
  hook:    [0.0, 2.0],   // 54 stickers · 6 colours · 1 solution
  anatomy: [2.0, 5.0],   // 6 centers + 12 edges + 8 corners = 26 pieces
  moves:   [5.0, 8.0],   // R U R' U' → scramble
  states:  [8.0, 11.0],  // 43,252,003,274,489,856,000
  god:     [11.0, 13.5], // God's number: 20
  outro:   [13.5, 15.0],
};
export const SCENES = [
  { id: '01', name: 'Hook', t: S.hook },
  { id: '02', name: 'Anatomy', t: S.anatomy },
  { id: '03', name: 'Notation', t: S.moves },
  { id: '04', name: 'States', t: S.states },
  { id: '05', name: "God's Number", t: S.god },
  { id: '06', name: 'Solved', t: S.outro },
];
export const sceneIndex = t => Math.max(0, SCENES.findIndex(s => t >= s.t[0] && t < s.t[1]));

// ---- the 20-move story ------------------------------------------------------
// R U R' U' (taught on the beat) + 16 accelerating moves = a 20-move scramble.
// Scene 5 plays the exact inverse: solved in 20 — God's number.
export const DEMO = ["R", "U", "R'", "U'"];
export const SCRAMBLE16 = scramble(16, 20260515, 1 /* last demo move is on the y axis */);
export const SCRAMBLE20 = [...DEMO, ...SCRAMBLE16];
export const SOLVE20 = [...SCRAMBLE20].reverse().map(invertName);

// Deliberate turn: snappy acceleration, hard landing (the settle wobble follows).
const turnEase = E.inOutQuart;
const fastEase = E.inOutQuad;

export const MAIN_SCHEDULE = [];
// demo moves land exactly on beats 5.5, 6.0, 6.5, 7.0
DEMO.forEach((n, i) => {
  const t1 = 5.5 + i * BEAT;
  MAIN_SCHEDULE.push({ m: parseMove(n), t0: t1 - 0.3, t1, ease: turnEase, settle: 0.16, kind: 'demo', idx: i });
});
// 16 accelerating scramble moves: 7.06 → 8.00 (the last one lands on the drop)
{
  const n = 16, start = 7.06, end = 8.0;
  const r = 0.9;
  const d0 = (end - start) * (1 - r) / (1 - Math.pow(r, n));
  let t = start;
  SCRAMBLE16.forEach((name, i) => {
    const d = d0 * Math.pow(r, i);
    MAIN_SCHEDULE.push({ m: parseMove(name), t0: t, t1: t + d, ease: fastEase, kind: 'scramble', idx: i });
    t += d;
  });
}
// 20 solving moves on straight 16th notes; the 20th lands on 13.5 — the impact.
SOLVE20.forEach((name, i) => {
  const t1 = S.god[0] + (i + 1) * (BEAT / 4);
  MAIN_SCHEDULE.push({ m: parseMove(name), t0: t1 - 0.112, t1, ease: E.inOutCubic, kind: 'solve', idx: i, settle: i === 19 ? 0.2 : 0 });
});
export const SOLVE_TIMES = MAIN_SCHEDULE.filter(s => s.kind === 'solve').map(s => s.t1);
export const SCRAMBLE_TIMES = MAIN_SCHEDULE.filter(s => s.kind === 'scramble').map(s => s.t1);

// ---- scene 1 assembly: 26 pieces snap in, structural order ------------------
// core → centers → edges → corners (foreshadowing the anatomy scene).
export function assemblyTimes(cubies, rand) {
  const order = { core: 0, center: 1, edge: 2, corner: 3 };
  const windows = { core: [0.16, 0.18], center: [0.26, 0.42], edge: [0.44, 0.72], corner: [0.76, 0.98] };
  const groups = {};
  cubies.forEach((k, i) => { (groups[k.type] ||= []).push(i); });
  const land = new Array(cubies.length);
  for (const type of Object.keys(order)) {
    const ids = groups[type];
    ids.sort(() => rand() - 0.5);
    const [a, b] = windows[type];
    ids.forEach((id, j) => { land[id] = ids.length === 1 ? a : a + (b - a) * (j / (ids.length - 1)); });
  }
  return land;
}

// ---- digits ------------------------------------------------------------------
export const BIGNUM = '43,252,003,274,489,856,000';
export const BIGNUM_LINES = ['43,252,003,', '274,489,', '856,000'];

import * as THREE from 'three';
import { rng } from './util.js';

// Standard notation. Axis 0=x (R/L), 1=y (U/D), 2=z (F/B); F faces the +z camera side.
// A clockwise quarter turn of a face, seen from that face, is a -90° rotation
// about its outward axis.
const FACES = {
  R: { axis: 0, layer: 1, dir: -1 }, L: { axis: 0, layer: -1, dir: 1 },
  U: { axis: 1, layer: 1, dir: -1 }, D: { axis: 1, layer: -1, dir: 1 },
  F: { axis: 2, layer: 1, dir: -1 }, B: { axis: 2, layer: -1, dir: 1 },
};
export const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

export function parseMove(name) {
  const f = FACES[name[0]];
  const prime = name.length > 1;
  return { name, face: name[0], prime, axis: f.axis, layer: f.layer, angle: f.dir * (prime ? -1 : 1) * Math.PI / 2 };
}
export const invertName = n => (n.length > 1 ? n[0] : n + "'");

// Random move sequence with no two consecutive moves on the same axis
// (so nothing cancels or commutes into a shorter sequence).
export function scramble(n, seed, avoidAxis = -1) {
  const r = rng(seed), out = [];
  let last = avoidAxis;
  const faces = 'RLUDFB';
  while (out.length < n) {
    const f = faces[Math.floor(r() * 6)];
    const ax = FACES[f].axis;
    if (ax === last) continue;
    out.push(f + (r() < 0.5 ? '' : "'"));
    last = ax;
  }
  return out;
}

const _q = new THREE.Quaternion();
export class CubeState {
  constructor() {
    this.c = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++)
      this.c.push({ home: [x, y, z], p: new THREE.Vector3(x, y, z), q: new THREE.Quaternion() });
  }
  reset() { for (const k of this.c) { k.p.set(...k.home); k.q.identity(); } return this; }
  copy(o) { this.c.forEach((k, i) => { k.p.copy(o.c[i].p); k.q.copy(o.c[i].q); }); return this; }
  inLayer(k, m) { return Math.round(k.p.getComponent(m.axis)) === m.layer; }
  apply(m) {
    _q.setFromAxisAngle(AXES[m.axis], m.angle);
    for (const k of this.c) if (this.inLayer(k, m)) {
      k.p.applyQuaternion(_q);
      k.p.set(Math.round(k.p.x), Math.round(k.p.y), Math.round(k.p.z));
      k.q.premultiply(_q).normalize();
    }
    return this;
  }
}

// Evaluate a move schedule at time t: completed moves are baked into `state`,
// the in-flight move (if any) is returned with its eased rotation angle.
// schedule: [{m, t0, t1, ease, settle}] sorted, non-overlapping.
export function evalSchedule(state, base, schedule, t) {
  state.copy(base);
  let partial = null;
  for (const s of schedule) {
    if (t >= s.t1) { state.apply(s.m); continue; }
    if (t > s.t0) partial = { m: s.m, a: s.m.angle * s.ease((t - s.t0) / (s.t1 - s.t0)) };
    break;
  }
  // after-landing wobble of the last finished move (a real cube "clacks" and settles)
  if (!partial) {
    let last = null;
    for (const s of schedule) if (t >= s.t1) last = s; else break;
    if (last && last.settle && t < last.t1 + last.settle) {
      const u = (t - last.t1) / last.settle;
      const w = Math.sin(u * Math.PI * 2.0) * Math.exp(-u * 4.0) * 0.07 * Math.sign(last.m.angle);
      partial = { m: last.m, a: w, post: true };
    }
  }
  return partial;
}

// World transform (relative to the cube root) of a cubie, given an optional partial turn.
const _pq = new THREE.Quaternion();
export function cubieTransform(state, k, partial, outPos, outQuat) {
  outPos.copy(k.p); outQuat.copy(k.q);
  if (partial && state.inLayer(k, partial.m)) {
    _pq.setFromAxisAngle(AXES[partial.m.axis], partial.a);
    outPos.applyQuaternion(_pq);
    outQuat.premultiply(_pq);
  }
}

// Facelet colours, Western scheme: U white, D yellow, F green, B blue, R red, L orange.
export const FACE_COLOR = {
  px: '#E5322D', nx: '#FF7A00', py: '#F4F2EC', ny: '#FFD400', pz: '#10B062', nz: '#1E50FF',
};
// Outward normals of a cubie (in its home frame) that carry stickers.
export function stickerFaces(home) {
  const out = [];
  const [x, y, z] = home;
  if (x === 1) out.push({ n: [1, 0, 0], col: FACE_COLOR.px });
  if (x === -1) out.push({ n: [-1, 0, 0], col: FACE_COLOR.nx });
  if (y === 1) out.push({ n: [0, 1, 0], col: FACE_COLOR.py });
  if (y === -1) out.push({ n: [0, -1, 0], col: FACE_COLOR.ny });
  if (z === 1) out.push({ n: [0, 0, 1], col: FACE_COLOR.pz });
  if (z === -1) out.push({ n: [0, 0, -1], col: FACE_COLOR.nz });
  return out;
}
export function pieceType(home) {
  const n = home.reduce((a, v) => a + (v !== 0 ? 1 : 0), 0);
  return ['core', 'center', 'edge', 'corner'][n];
}

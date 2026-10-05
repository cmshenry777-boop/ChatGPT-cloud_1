// Timing + easing toolkit. Everything in the reel is a pure function of time `t`
// (seconds), so any frame can be rendered in any order, deterministically.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, x) => clamp((x - a) / (b - a));
export const smooth = (a, b, x) => { const t = inv(a, b, x); return t * t * (3 - 2 * t); };
export const loglerp = (a, b, t) => Math.exp(lerp(Math.log(a), Math.log(b), t));

export const E = {
  lin: x => x,
  inQuad: x => x * x,
  outQuad: x => 1 - (1 - x) * (1 - x),
  inOutQuad: x => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  inCubic: x => x * x * x,
  outCubic: x => 1 - Math.pow(1 - x, 3),
  inOutCubic: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  inQuart: x => x * x * x * x,
  outQuart: x => 1 - Math.pow(1 - x, 4),
  inOutQuart: x => (x < 0.5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2),
  outQuint: x => 1 - Math.pow(1 - x, 5),
  inOutQuint: x => (x < 0.5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2),
  inExpo: x => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  outExpo: x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutExpo: x => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outBack: (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
  inBack: (x, s = 1.70158) => (s + 1) * x * x * x - s * x * x,
  outCirc: x => Math.sqrt(1 - Math.pow(x - 1, 2)),
  // under-damped spring that settles on 1 (used for "landing" type and pieces)
  spring: (x, k = 7, z = 0.32) => (x >= 1 ? 1 : 1 - Math.exp(-z * k * x * 2.2) * Math.cos(k * x * 2.2 * Math.sqrt(1 - z * z))),
};

// Piecewise keyframe track: keys = [[t, value, ease?], ...]; ease applies to the
// segment that *ends* at that key. Values may be numbers or arrays of numbers.
export function track(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ez] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const p = (ez || E.inOutCubic)(inv(t0, t1, t));
      if (Array.isArray(v0)) return v0.map((a, j) => lerp(a, v1[j], p));
      return lerp(v0, v1, p);
    }
  }
  return keys[keys.length - 1][1];
}

// Seeded PRNG (mulberry32) — determinism for scrambles, glyph noise, etc.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (a, b = 0) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

// Smooth 1D value noise for camera shake / organic drift.
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed) * 2 - 1, hash(i + 1, seed) * 2 - 1, u);
}

// Mask reveal: returns translateY percent for a line that slides up into a mask
// at tIn and slides out of it at tOut.
export function reveal(t, tIn, tOut = Infinity, dur = 0.5, durOut = 0.3, ez = E.outExpo) {
  if (t < tIn) return 110;
  if (t < tIn + dur) return 110 * (1 - ez(inv(tIn, tIn + dur, t)));
  if (t < tOut) return 0;
  if (t < tOut + durOut) return -110 * E.inExpo(inv(tOut, tOut + durOut, t)) ** 0.8;
  return -110;
}

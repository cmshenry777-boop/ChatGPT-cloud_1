// 2D layer: typography, callouts, transitions, HUD. Pure function of time.
import { E, clamp, lerp, inv, track, reveal, hash, smooth } from './util.js';
import { SCENES, sceneIndex, DEMO, SOLVE20, SOLVE_TIMES, MAIN_SCHEDULE, BIGNUM_LINES, FPS } from './timeline.js';

const C = { ink: '#0C0C0E', paper: '#EEEAE2', yel: '#FFD400', R: '#E5322D', O: '#FF7A00', B: '#1E50FF', G: '#10B062', W: '#F4F2EC', Y: '#FFD400' };
const FACEC = { R: C.R, L: C.O, U: C.W, D: C.Y, F: C.G, B: C.B };
const PRIME = '′';
const pretty = n => n.replace("'", PRIME);
const X0 = 84;

const $ = id => document.getElementById(id);
function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}
const fg = $('fg'), back = $('back'), hud = $('hud'), wipe = $('wipe'), lines = $('lines');

// ------------------------------------------------------------------ primitives
// Wrap every visible character in .ch spans (keeps nested colour spans).
function splitChars(node) {
  const out = [];
  [...node.childNodes].forEach(n => {
    if (n.nodeType === 3) {
      const frag = document.createDocumentFragment();
      for (const ch of n.textContent) {
        const s = document.createElement('span');
        s.className = 'ch';
        s.textContent = ch === ' ' ? ' ' : ch;
        frag.appendChild(s); out.push(s);
      }
      n.replaceWith(frag);
    } else if (n.nodeType === 1) {
      if (n.classList.contains('roll')) { out.push(n); return; }
      out.push(...splitChars(n));
    }
  });
  return out;
}

class Line {
  // A line of type that rises into a mask; optional per-character stagger.
  constructor(parent, html, { x = X0, y, cls = '', style = {}, tIn, tOut = Infinity, dur = 0.55, durOut = 0.3, stagger = 0, align = 'left' }) {
    this.wrap = el('div', 'abs ' + cls, parent);
    Object.assign(this.wrap.style, { left: x + 'px', top: y + 'px' }, style);
    if (align === 'right') { this.wrap.style.left = 'auto'; this.wrap.style.right = (1080 - x) + 'px'; }
    if (align === 'center') { this.wrap.style.transform = 'translateX(-50%)'; }
    this.mask = el('span', 'mask', this.wrap);
    this.inner = el('span', 'inner', this.mask, html);
    Object.assign(this, { tIn, tOut, dur, durOut, stagger });
    this.chars = stagger ? splitChars(this.inner) : null;
  }
  update(t) {
    const vis = t > this.tIn - 0.01 && t < this.tOut + this.durOut + (this.chars ? this.chars.length * this.stagger : 0) + 0.02;
    this.wrap.style.visibility = vis ? 'visible' : 'hidden';
    if (!vis) return;
    if (!this.chars) {
      this.inner.style.transform = `translateY(${reveal(t, this.tIn, this.tOut, this.dur, this.durOut)}%)`;
    } else {
      this.chars.forEach((c, i) => {
        const d = i * this.stagger;
        c.style.transform = `translateY(${reveal(t, this.tIn + d, this.tOut + d * 0.5, this.dur, this.durOut)}%)`;
      });
    }
  }
}

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=/<>';
class Decode {
  // Mono label that "decodes" from noise, then masks out.
  constructor(parent, text, { x = X0, y, cls = 'mono', style = {}, tIn, tOut = Infinity, dur = 0.42, align = 'left' }) {
    this.wrap = el('div', 'abs ' + cls, parent);
    Object.assign(this.wrap.style, { top: y + 'px' }, style);
    if (align === 'right') this.wrap.style.right = (1080 - x) + 'px'; else this.wrap.style.left = x + 'px';
    this.mask = el('span', 'mask', this.wrap);
    this.inner = el('span', 'inner', this.mask);
    Object.assign(this, { text, tIn, tOut, dur, seed: Math.floor(hash(text.length, y) * 1e6) });
  }
  update(t) {
    const vis = t > this.tIn && t < this.tOut + 0.3;
    this.wrap.style.visibility = vis ? 'visible' : 'hidden';
    if (!vis) return;
    const n = this.text.length, f = Math.floor(t * 30);
    let s = '';
    for (let i = 0; i < n; i++) {
      const ch = this.text[i];
      const ri = this.tIn + this.dur * (i / n);
      if (ch === ' ') s += ' ';
      else if (t < ri - 0.1) s += ' ';
      else if (t < ri + 0.04) s += GLYPHS[Math.floor(hash(this.seed + i, f) * GLYPHS.length)];
      else s += ch;
    }
    this.inner.textContent = s;
    this.inner.style.transform = `translateY(${t > this.tOut ? reveal(t, -1, this.tOut, 0.1, 0.28) : 0}%)`;
  }
}

class Roller {
  // A digit cell with a vertical strip of numerals; pos is a float strip index.
  constructor(parent, { cells = 50, cls = '' } = {}) {
    this.r = el('span', 'roll ' + cls, parent);
    this.strip = el('span', 'strip', this.r);
    let h = '';
    for (let i = 0; i < cells; i++) h += `<span>${i % 10}</span>`;
    this.strip.innerHTML = h;
    this.last = null;
  }
  set(pos, vel = 0) {
    this.strip.style.transform = `translateY(${-pos}em)`;
    const v = Math.abs(vel);
    const lvl = v > 46 ? 4 : v > 28 ? 3 : v > 14 ? 2 : v > 6 ? 1 : 0;
    this.strip.style.filter = lvl ? `url(#mb${lvl})` : 'none';
  }
}

function setStyle(e, o) { Object.assign(e.style, o); }

// ================================================================== HUD
const HUD = {};
{
  HUD.tl = el('div', 'h', hud, "RUBIK'S CUBE<br><span style='opacity:.55'>BY THE NUMBERS</span>");
  setStyle(HUD.tl, { left: '48px', top: '40px' });
  HUD.tr = el('div', 'h', hud, '');
  setStyle(HUD.tr, { right: '48px', top: '40px', textAlign: 'right' });
  HUD.bl = el('div', 'h', hud, '');
  setStyle(HUD.bl, { left: '48px', bottom: '40px' });
  HUD.br = el('div', 'h', hud, "MOTION — CLAUDE<br><span style='opacity:.55'>SHOWREEL ’26</span>");
  setStyle(HUD.br, { right: '48px', bottom: '40px', textAlign: 'right' });
  HUD.crops = [[16, 16, 1, 1], [1064, 16, -1, 1], [16, 1904, 1, -1], [1064, 1904, -1, -1]].map(([x, y, sx, sy]) => {
    const c = el('div', 'crop', hud);
    setStyle(c, { left: (sx > 0 ? x : x - 26) + 'px', top: (sy > 0 ? y : y - 26) + 'px',
      [sx > 0 ? 'borderLeft' : 'borderRight']: '2px solid currentColor', [sy > 0 ? 'borderTop' : 'borderBottom']: '2px solid currentColor' });
    return c;
  });
  HUD.prog = el('div', '', hud); HUD.prog.id = 'progress';
  HUD.ticks = SCENES.map(s => { const d = el('div', '', hud); setStyle(d, { position: 'absolute', top: '0px', width: '3px', height: '12px', left: (s.t[0] / 15 * 1080) + 'px' }); return d; });
}

// ================================================================== WIPES
const CELLS = [];
for (let r = 0; r < 16; r++) for (let c = 0; c < 9; c++) {
  const d = el('div', 'wipeCell', wipe);
  setStyle(d, { left: c * 120 + 'px', top: r * 120 + 'px', width: '120px', height: '120px' });
  CELLS.push({ d, r, c, cx: c * 120 + 60, cy: r * 120 + 60 });
}
const HBANDS = [0, 1, 2].map(k => { const d = el('div', 'band', wipe); setStyle(d, { left: 0, top: k * 640 + 'px', width: '1080px', height: '641px' }); return d; });
const VBANDS = [0, 1, 2].map(k => { const d = el('div', 'band', wipe); setStyle(d, { left: k * 360 + 'px', top: 0, width: '361px', height: '1920px' }); return d; });

function bgAt(t) {
  if (t < 2.06) return C.ink;
  if (t < 4.78) return C.paper;
  if (t < 11.06) return C.ink;
  if (t < 13.5) return C.yel;
  return C.ink;
}
function updateWipes(t) {
  $('bgColor').style.background = bgAt(t);
  // T1 ink → paper: sticker cells pop in from bottom-left, diagonally
  const t1On = t > 1.74 && t < 2.06;
  // T5 yellow → ink: cells collapse radially from the solved cube
  const t5On = t >= 13.5 && t < 13.98;
  CELLS.forEach(k => {
    let s = 0, col = C.paper;
    if (t1On) {
      const d = ((8 - k.c) + (15 - k.r)) / 23;   // sweeps from the bottom-right, away from the type
      const t0 = 1.76 + 0.12 * d;
      s = 1.34 * E.outCubic(inv(t0, t0 + 0.18, t));
    } else if (t5On) {
      const d = Math.hypot(k.cx - 540, k.cy - 1010) / 1150;
      const t0 = 13.5 + 0.26 * d;
      s = 1.34 * (1 - E.inBack(inv(t0, t0 + 0.2, t), 1.4));
      col = C.yel;
    }
    k.d.style.display = s > 0.002 ? 'block' : 'none';
    if (s > 0.002) { k.d.style.transform = `scale(${s})`; k.d.style.background = col; }
  });
  // T2 paper → ink: three horizontal slabs slide off like U / E / D slice turns
  HBANDS.forEach((b, k) => {
    const t0 = 4.78 + 0.05 * k;
    const on = t > 4.6 && t < t0 + 0.34;
    b.style.display = on && t >= 4.78 ? 'block' : 'none';
    if (!on) return;
    const x = (k % 2 ? 1 : -1) * 1100 * E.inOutExpo(inv(t0, t0 + 0.32, t));
    setStyle(b, { transform: `translateX(${x}px)`, background: C.paper });
  });
  // T4 ink → yellow: three vertical slabs slide in like L / M / R slice turns
  VBANDS.forEach((b, k) => {
    const t0 = 10.72 + 0.05 * k;
    const on = t > t0 && t < 11.06;
    b.style.display = on ? 'block' : 'none';
    if (!on) return;
    const y = (k % 2 ? 1 : -1) * 1920 * (1 - E.inOutExpo(inv(t0, t0 + 0.3, t)));
    setStyle(b, { transform: `translateY(${y}px)`, background: C.yel });
  });
  $('blueprint').style.opacity = track(t, [[2.0, 0], [2.3, 1], [4.7, 1], [4.85, 0]]);
  // flashes on the two big hits
  const fl = Math.max(
    t >= 8.0 ? 0.55 * Math.exp(-(t - 8.0) * 16) : 0,
    t >= 13.5 ? 0.4 * Math.exp(-(t - 13.5) * 14) : 0,
    t >= 11.0 ? 0.25 * Math.exp(-(t - 11.0) * 18) : 0);
  $('flash').style.opacity = fl;
  $('fade').style.opacity = track(t, [[0, 1], [0.12, 0, E.outQuad], [14.72, 0], [15.0, 1, E.inQuad]]);
  $('scrim').style.opacity = track(t, [[8.3, 0], [8.8, 0.85], [10.45, 0.85], [10.8, 0]]);
}

// ================================================================== SCENE 1 — HOOK
const items = [];
const add = x => (items.push(x), x);
add(new Decode(fg, 'FIG.00 — ERNŐ RUBIK, 1974', { y: 190, tIn: 0.06, tOut: 1.54, style: { fontSize: '24px', letterSpacing: '0.16em' } }));
add(new Line(fg, "RUBIK’S", { y: 238, cls: 'disp', style: { fontSize: '168px' }, tIn: 0.1, tOut: 1.54, durOut: 0.2, stagger: 0.028 }));
add(new Line(fg, 'CUBE', { y: 384, cls: 'disp', style: { fontSize: '168px' }, tIn: 0.2, tOut: 1.58, durOut: 0.2, stagger: 0.028 }));
const H1 = [
  [`<span style="color:${C.R}">54</span>개의 칸,`, 0.5],
  [`<span style="color:${C.B}">6</span>가지 색,`, 0.75],
  [`정답은 <span style="color:${C.Y}">단 하나.</span>`, 1.0],
];
H1.forEach(([h, tIn], i) => add(new Line(fg, h, { y: 1372 + i * 112, cls: 'kr', style: { fontSize: '100px' }, tIn, tOut: 1.52 + i * 0.03, dur: 0.5, durOut: 0.2 })));

// ================================================================== SCENE 2 — ANATOMY
add(new Decode(fg, 'FIG.01 — ANATOMY / 구조', { y: 190, tIn: 2.1, tOut: 4.84, style: { fontSize: '24px', letterSpacing: '0.16em', color: C.ink } }));
const EQ = el('div', 'abs disp tab', fg);
setStyle(EQ, { left: X0 + 'px', top: '240px', fontSize: '150px', color: C.ink, fontStretch: '108%', letterSpacing: '-0.035em' });
const eqTokens = [
  { s: '6', tIn: 2.36, group: 'center' }, { s: '+', tIn: 3.16 }, { s: '12', tIn: 3.2, group: 'edge' },
  { s: '+', tIn: 3.96 }, { s: '8', tIn: 4.0, group: 'corner' }, { s: '=', tIn: 4.46 }, { s: '26', tIn: 4.5, group: 'total' },
].map(tk => {
  const m = el('span', 'mask', EQ); m.style.display = 'inline-block'; m.style.marginRight = tk.s === '+' || tk.s === '=' ? '0.02em' : '0.04em';
  const i = el('span', 'inner', m, tk.s);
  if (tk.s === '+' || tk.s === '=') { i.style.fontWeight = 500; }
  return { ...tk, m, i };
});
const GROUPC = { center: C.B, edge: C.R, corner: C.G };
const PH = { center: [2.36, 3.16], edge: [3.16, 3.96], corner: [3.96, 4.42], total: [4.52, 4.9] };
const LABELS = [
  { g: 'center', mono: 'A — CENTER × 6', kr: '센터 · 고정', sub: '면의 색을 정하는 축' },
  { g: 'edge', mono: 'B — EDGE × 12', kr: '엣지 · 2색', sub: '두 면 사이의 조각' },
  { g: 'corner', mono: 'C — CORNER × 8', kr: '코너 · 3색', sub: '세 면이 만나는 꼭짓점' },
  { g: 'total', mono: 'Σ — PIECES', kr: '26개의 조각', sub: '+ 회전축 하나' },
].map(L => {
  const [a, b] = PH[L.g];
  const col = GROUPC[L.g] || C.ink;
  return {
    ...L,
    m: add(new Line(fg, `<span style="display:inline-block;width:18px;height:18px;background:${col};margin-right:14px;vertical-align:-1px"></span>${L.mono}`, { y: 1452, cls: 'mono', style: { fontSize: '26px', color: C.ink, letterSpacing: '0.14em' }, tIn: a + 0.02, tOut: b - 0.06, dur: 0.4, durOut: 0.18 })),
    k: add(new Line(fg, L.kr, { y: 1500, cls: 'kr', style: { fontSize: '112px', color: C.ink }, tIn: a + 0.05, tOut: b - 0.06, dur: 0.45, durOut: 0.18 })),
    s: add(new Line(fg, L.sub, { y: 1636, cls: 'kr', style: { fontSize: '40px', fontWeight: 600, color: 'rgba(12,12,14,.6)', letterSpacing: '-0.02em' }, tIn: a + 0.1, tOut: b - 0.06, dur: 0.45, durOut: 0.18 })),
  };
});
const leader = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
leader.setAttribute('fill', 'none'); leader.setAttribute('stroke', C.ink); leader.setAttribute('stroke-width', '2.5');
lines.appendChild(leader);
const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
dot.setAttribute('r', '13'); dot.setAttribute('stroke', C.ink); dot.setAttribute('stroke-width', '3');
lines.appendChild(dot);
const dotIn = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
dotIn.setAttribute('r', '4'); dotIn.setAttribute('fill', C.ink);
lines.appendChild(dotIn);

// ================================================================== SCENE 3 — NOTATION
add(new Decode(fg, 'FIG.02 — NOTATION / 회전 기호', { y: 190, tIn: 5.1, tOut: 7.9, style: { fontSize: '24px', letterSpacing: '0.16em' } }));
const BIG = el('div', 'abs disp', back);
setStyle(BIG, { left: '540px', top: '300px', fontSize: '1180px', lineHeight: '0.8', transformOrigin: '50% 60%' });
const NOTE = el('div', 'abs', fg);
setStyle(NOTE, { left: X0 + 'px', top: '1370px', height: '160px', width: '900px' });
const noteTok = DEMO.map((n, i) => {
  const m = el('span', 'mask abs disp', NOTE);
  setStyle(m, { left: i * 196 + 'px', top: 0, fontSize: '132px', fontStretch: '112%' });
  const inner = el('span', 'inner', m, pretty(n));
  return { m, inner };
});
const noteBar = el('div', 'abs', NOTE);
setStyle(noteBar, { top: '138px', height: '10px', background: C.yel });
add(new Line(fg, '6개의 면, 90° 회전.', { y: 1560, cls: 'kr', style: { fontSize: '58px', fontWeight: 800 }, tIn: 5.3, tOut: 6.98, dur: 0.5, durOut: 0.18 }));
add(new Line(fg, `<span style="opacity:.5">규칙은 이게 전부.</span>`, { y: 1630, cls: 'kr', style: { fontSize: '58px', fontWeight: 800 }, tIn: 5.42, tOut: 7.0, dur: 0.5, durOut: 0.18 }));
add(new Line(fg, '그런데 섞기 시작하면', { y: 1400, cls: 'kr', style: { fontSize: '92px' }, tIn: 7.16, tOut: 7.84, dur: 0.4, durOut: 0.18, stagger: 0.016 }));
add(new Line(fg, `<span style="color:${C.yel}">→</span>`, { y: 1512, cls: 'kr', style: { fontSize: '92px' }, tIn: 7.34, tOut: 7.86, dur: 0.4, durOut: 0.18 }));

// ================================================================== SCENE 4 — STATES
add(new Decode(fg, 'FIG.03 — STATES / 경우의 수', { y: 190, tIn: 8.12, tOut: 10.6, style: { fontSize: '24px', letterSpacing: '0.16em' } }));
const NUMBLOCK = el('div', 'abs', fg);
setStyle(NUMBLOCK, { left: X0 - 26 + 'px', top: '250px' });
const numRows = [];
const rollers = [];
{
  let digitIdx = 0;
  BIGNUM_LINES.forEach((line, r) => {
    const plate = el('div', 'plate', NUMBLOCK);
    setStyle(plate, { left: 0, top: r * 178 + 'px', height: '172px', background: C.ink });
    const txt = el('div', 'abs disp tab', NUMBLOCK);
    setStyle(txt, { left: '26px', top: r * 178 + 18 + 'px', fontSize: '148px', lineHeight: '1', fontStretch: '100%', letterSpacing: '-0.01em' });
    const commas = [];
    for (const ch of line) {
      if (ch === ',') { const c = el('span', '', txt, ','); c.style.display = 'inline-block'; commas.push(c); continue; }
      const ro = new Roller(txt, { cells: 50 });
      ro.r.style.height = '1em';
      ro.final = +ch; ro.idx = digitIdx++; ro.row = r;
      rollers.push(ro);
    }
    numRows.push({ plate, txt, commas, r });
  });
}
const plateIn = r => 8.08 + r * 0.07;
const lockAt = i => 8.3 + i * 0.052;
const NUMLABEL = el('div', 'abs', fg);
setStyle(NUMLABEL, { left: X0 - 26 + 'px', top: '800px', height: '96px', background: C.yel, color: C.ink, transformOrigin: '0 50%' });
const numLabelTxt = el('div', 'abs kr', NUMLABEL, '가지의 상태 <span style="font-weight:600;opacity:.55">— 약 4,325경</span>');
setStyle(numLabelTxt, { left: '26px', top: '14px', fontSize: '60px' });
const FACT = el('div', 'abs', fg);
setStyle(FACT, { left: X0 - 26 + 'px', top: '1380px', width: '780px', height: '336px', background: C.ink, transformOrigin: '0 50%' });
add(new Line(FACT, '1초에 하나씩 확인해도', { x: 26, y: 26, cls: 'kr', style: { fontSize: '52px', fontWeight: 700 }, tIn: 9.72, tOut: 10.56, dur: 0.45 }));
add(new Line(FACT, `<span style="color:${C.yel}">1.4조 년</span>`, { x: 26, y: 96, cls: 'kr', style: { fontSize: '140px' }, tIn: 9.82, tOut: 10.58, dur: 0.5, stagger: 0.03 }));
add(new Line(FACT, '우주 나이의 약 100배.', { x: 26, y: 254, cls: 'kr', style: { fontSize: '48px', fontWeight: 700, opacity: 0.6 }, tIn: 9.96, tOut: 10.6, dur: 0.45 }));

// ================================================================== SCENE 5 — GOD'S NUMBER
add(new Decode(fg, "FIG.04 — GOD’S NUMBER / 신의 숫자", { y: 190, tIn: 11.06, tOut: 13.42, style: { fontSize: '24px', letterSpacing: '0.16em', color: C.ink } }));
const COUNT = el('div', 'abs disp tab', back);
setStyle(COUNT, { left: '540px', top: '196px', fontSize: '660px', lineHeight: '1', color: C.ink, fontStretch: '118%', letterSpacing: '-0.04em', transform: 'translateX(-50%)' });
const cTens = new Roller(COUNT, { cells: 12 }); cTens.r.style.height = '0.84em';
const cUnits = new Roller(COUNT, { cells: 30 }); cUnits.r.style.height = '0.84em';
[cTens, cUnits].forEach(r => { r.strip.querySelectorAll('span').forEach(s => { s.style.height = '0.84em'; s.style.lineHeight = '0.84em'; }); });
add(new Line(fg, '어떤 상태든', { y: 1466, cls: 'kr', style: { fontSize: '100px', color: C.ink }, tIn: 11.2, tOut: 13.38, dur: 0.5 }));
add(new Line(fg, '<span style="background:#0C0C0E;color:#FFD400;padding:0 14px;margin-left:-14px">20수</span> 안에 풀린다.', { y: 1580, cls: 'kr', style: { fontSize: '100px', color: C.ink }, tIn: 11.34, tOut: 13.4, dur: 0.5 }));
add(new Line(fg, 'PROVEN 2010 · 35 CPU-YEARS', { y: 1716, cls: 'mono', style: { fontSize: '24px', color: C.ink, letterSpacing: '0.16em', opacity: 0.65 }, tIn: 11.5, tOut: 13.4, dur: 0.4 }));
const TICK = el('div', 'abs mono', fg);
setStyle(TICK, { left: 0, top: '1398px', fontSize: '30px', color: C.ink, letterSpacing: '0.04em', height: '48px', width: '1080px', overflow: 'hidden' });
const TICKSTRIP = el('div', 'abs', TICK);
const tickTok = SOLVE20.map((n, i) => {
  const s = el('span', 'abs', TICKSTRIP, pretty(n));
  setStyle(s, { left: i * 78 + 'px', top: '4px', width: '66px', textAlign: 'center', lineHeight: '40px', borderRadius: '6px' });
  return s;
});

// ================================================================== SCENE 6 — OUTRO
add(new Line(fg, "RUBIK’S", { y: 200, cls: 'disp', style: { fontSize: '174px' }, tIn: 13.56, tOut: 15.5, stagger: 0.03, dur: 0.6 }));
add(new Line(fg, 'CUBE', { y: 352, cls: 'disp', style: { fontSize: '174px', color: C.yel }, tIn: 13.66, tOut: 15.5, stagger: 0.03, dur: 0.6 }));
add(new Line(fg, '혼돈 속에도,', { y: 1400, cls: 'kr', style: { fontSize: '96px' }, tIn: 13.82, tOut: 15.5, dur: 0.55 }));
add(new Line(fg, '해법은 있다.', { y: 1510, cls: 'kr', style: { fontSize: '96px' }, tIn: 13.92, tOut: 15.5, dur: 0.55 }));
add(new Decode(fg, '54 STICKERS · 26 PIECES · 43 QUINTILLION STATES · 20 MOVES', { y: 1660, tIn: 14.0, tOut: 15.5, dur: 0.5, style: { fontSize: '19px', letterSpacing: '0.1em', opacity: 0.6 } }));
add(new Decode(fg, 'MOTION DESIGN — CLAUDE', { y: 1700, tIn: 14.12, tOut: 15.5, dur: 0.4, style: { fontSize: '24px', letterSpacing: '0.16em', color: C.yel } }));

// ================================================================== update
function sceneInk(t) { const bg = bgAt(t); return bg === C.ink ? C.paper : C.ink; }

function stepCount(times, t, dur = 0.09) {
  let c = 0, v = 0;
  for (const T of times) {
    const x = inv(T - 0.01, T - 0.01 + dur, t);
    c += E.outBack(x, 1.3);
    if (x > 0 && x < 1) v += 1 / dur * 1.6;
  }
  return [c, v];
}

export function updateOverlay(t, ctx) {
  updateWipes(t);
  const ink = sceneInk(t);
  fg.style.color = ink;
  hud.style.color = ink;

  // ---- HUD
  const si = sceneIndex(t);
  HUD.tr.innerHTML = `${SCENES[si].id} / 06<br><span style='opacity:.55'>${SCENES[si].name.toUpperCase()}</span>`;
  const fr = Math.round(t * FPS);
  const ss = Math.floor(fr / FPS), ff = fr % FPS;
  HUD.bl.innerHTML = `TC 00:00:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}<br><span style='opacity:.55'>3×3×3 · 1080×1920</span>`;
  HUD.prog.style.background = C.yel;
  HUD.prog.style.transform = `scaleX(${clamp(t / 15)})`;
  HUD.ticks.forEach(d => { d.style.background = ink; d.style.opacity = 0.5; });
  hud.style.opacity = track(t, [[0, 0], [0.25, 1]]) * 0.92;

  for (const it of items) it.update(t);

  // ---- scene 2: equation + callout
  eqTokens.forEach(tk => {
    tk.i.style.transform = `translateY(${reveal(t, tk.tIn, 4.82, 0.42, 0.2)}%)`;
    const act = tk.group && t >= PH[tk.group][0] && t < PH[tk.group][1];
    tk.i.style.color = tk.group === 'total' ? C.ink : act ? GROUPC[tk.group] : C.ink;
    tk.m.style.opacity = tk.group && !act && tk.group !== 'total' && t < 4.46 ? 0.28 : 1;
    if (tk.group === 'total') tk.i.style.background = `linear-gradient(transparent 58%, ${C.yel} 58%, ${C.yel} 92%, transparent 92%)`;
  });
  EQ.style.visibility = t > 2.3 && t < 5.05 ? 'visible' : 'hidden';
  let showLeader = false;
  for (const g of ['center', 'edge', 'corner']) {
    const [a, b] = PH[g];
    if (t > a + 0.04 && t < b - 0.06 && ctx.pieces[g]) {
      const p = ctx.pieces[g];
      const draw = E.outExpo(inv(a + 0.06, a + 0.4, t)) * (1 - E.inCubic(inv(b - 0.2, b - 0.06, t)));
      const ax = X0 + 2, ay = 1426;
      const mid = { x: p.x, y: ay };
      // polyline: piece → straight down → along the rule to the label
      const L1 = Math.abs(ay - p.y), L2 = Math.abs(p.x - ax), Lt = L1 + L2;
      const d = draw * Lt;
      let pts;
      if (d <= L1) pts = `${p.x},${p.y} ${p.x},${p.y + Math.sign(ay - p.y) * d}`;
      else pts = `${p.x},${p.y} ${mid.x},${mid.y} ${p.x + Math.sign(ax - p.x) * (d - L1)},${ay}`;
      leader.setAttribute('points', pts);
      dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
      dot.setAttribute('fill', GROUPC[g]);
      dot.setAttribute('r', 13 * E.outBack(clamp(draw * 3), 2));
      dotIn.setAttribute('cx', p.x); dotIn.setAttribute('cy', p.y);
      showLeader = true;
    }
  }
  lines.style.visibility = showLeader ? 'visible' : 'hidden';

  // ---- scene 3: big letter behind the cube + notation row
  const demo = MAIN_SCHEDULE.filter(s => s.kind === 'demo');
  let cur = -1;
  demo.forEach((s, i) => { if (t >= s.t0 - 0.05) cur = i; });
  const scr = MAIN_SCHEDULE.filter(s => s.kind === 'scramble');
  let scrCur = -1;
  scr.forEach((s, i) => { if (t >= s.t0) scrCur = i; });
  const bigOn = t > 5.12 && t < 8.0;
  BIG.style.visibility = bigOn ? 'visible' : 'hidden';
  if (bigOn) {
    let name = cur >= 0 ? demo[cur].m.name : 'R';
    let t0 = cur >= 0 ? demo[cur].t0 - 0.05 : 5.12;
    if (scrCur >= 0) { name = scr[scrCur].m.name; t0 = scr[scrCur].t0; }
    BIG.textContent = pretty(name);
    const p = E.outExpo(inv(t0, t0 + 0.3, t));
    const s = lerp(1.22, 1, p) * (cur < 0 ? E.outExpo(inv(5.12, 5.5, t)) : 1);
    const col = FACEC[name[0]];
    BIG.style.color = col;
    BIG.style.opacity = (scrCur >= 0 ? 0.9 : lerp(0.25, 1, p)) * (1 - smooth(7.9, 8.0, t));
    BIG.style.transform = `translateX(-50%) scale(${s})`;
  }
  const noteOn = t > 5.2 && t < 7.2;
  NOTE.style.visibility = noteOn ? 'visible' : 'hidden';
  if (noteOn) {
    noteTok.forEach((tk, i) => {
      tk.inner.style.transform = `translateY(${reveal(t, 5.22 + i * 0.05, 6.98 + i * 0.015, 0.5, 0.16)}%)`;
      tk.m.style.opacity = i === cur ? 1 : i < cur ? 0.42 : 0.2;
    });
    const bx = track(t, demo.flatMap((s, i) => [[s.t0 - 0.06, i === 0 ? 0 : (i - 1) * 196], [s.t0 + 0.12, i * 196, E.outExpo]]));
    const bw = cur < 0 ? 0 : (cur === 2 || cur === 3 ? 132 : 92);
    const barP = E.outExpo(inv(demo[0].t0 - 0.06, demo[0].t0 + 0.2, t)) * (1 - E.inExpo(inv(6.98, 7.12, t)));
    setStyle(noteBar, { left: bx + 'px', width: bw * barP + 'px' });
  }

  // ---- scene 4: the number
  const numOn = t > 8.0 && t < 10.75;
  NUMBLOCK.style.visibility = numOn ? 'visible' : 'hidden';
  if (numOn) {
    numRows.forEach(row => {
      const w = row.txt.offsetWidth + 52;
      const pin = E.outExpo(inv(plateIn(row.r), plateIn(row.r) + 0.32, t));
      const pout = E.inExpo(inv(10.42 + row.r * 0.04, 10.66 + row.r * 0.04, t));
      setStyle(row.plate, { width: w + 'px', transform: `scaleX(${pin * (1 - pout)})`, transformOrigin: pout > 0 ? '100% 50%' : '0 50%' });
      row.txt.style.opacity = pin > 0.4 && pout < 0.6 ? 1 : 0;
      row.commas.forEach(c => { c.style.color = C.yel; });
    });
    rollers.forEach(ro => {
      const ts = plateIn(ro.row) + 0.06, tl = lockAt(ro.idx);
      const x = inv(ts, tl, t);
      const e = E.outBack(x, 0.9);
      const pos = lerp(ro.final + 2, ro.final + 40, e);
      const dx = 1 / Math.max(1e-3, tl - ts);
      const de = (E.outBack(Math.min(1, x + 0.01), 0.9) - E.outBack(x, 0.9)) / 0.01;
      ro.set(pos, x > 0 && x < 1 ? 38 * de * dx : 0);
      ro.r.style.color = t >= tl ? C.paper : 'rgba(238,234,226,.62)';
    });
    const lw = numLabelTxt.offsetWidth + 52;
    const lin = E.outExpo(inv(9.3, 9.6, t)), lout = E.inExpo(inv(10.45, 10.68, t));
    setStyle(NUMLABEL, { width: lw + 'px', transform: `scaleX(${lin * (1 - lout)})`, transformOrigin: lout > 0 ? '100% 50%' : '0 50%' });
    numLabelTxt.style.opacity = lin > 0.5 && lout < 0.5 ? 1 : 0;
  }
  const fin = E.outExpo(inv(9.62, 9.94, t)), fout = E.inExpo(inv(10.5, 10.74, t));
  FACT.style.visibility = t > 9.6 && t < 10.76 ? 'visible' : 'hidden';
  FACT.style.transform = `scaleX(${fin * (1 - fout)})`;
  FACT.style.transformOrigin = fout > 0 ? '100% 50%' : '0 50%';
  NUMLABEL.style.visibility = t > 9.28 && t < 10.7 ? 'visible' : 'hidden';

  // ---- scene 5: the counter + move ticker
  const godOn = t > 11.0 && t < 13.62;
  COUNT.style.visibility = TICK.style.visibility = godOn ? 'visible' : 'hidden';
  if (godOn) {
    const [cu, vu] = stepCount(SOLVE_TIMES, t);
    const [ct, vt] = stepCount([SOLVE_TIMES[9], SOLVE_TIMES[19]], t, 0.12);
    cUnits.set(cu * 0.84, vu * 0.84);
    cTens.set(ct * 0.84, vt * 0.84);
    const ci = E.outExpo(inv(11.0, 11.35, t));
    const co = E.inExpo(inv(13.5, 13.62, t));
    COUNT.style.transform = `translateX(-50%) translateY(${(1 - ci) * 60}px) scale(${lerp(1.08, 1, ci)})`;
    COUNT.style.opacity = ci * (1 - co);
    // ticker: current move snaps into a black chip
    const done = SOLVE_TIMES.filter(T => t >= T - 0.01).length;
    const curI = Math.min(19, done);
    const sx = track(t, SOLVE_TIMES.flatMap((T, i) => [[T - 0.012, -(i) * 78 + 420], [T + 0.05, -(i + 1) * 78 + 420, E.outCubic]]));
    TICKSTRIP.style.transform = `translateX(${(t < SOLVE_TIMES[0] ? 420 : sx)}px)`;
    tickTok.forEach((s, i) => {
      const on = i === curI && done < 20;
      s.style.background = i < done ? C.ink : 'transparent';
      s.style.color = i < done ? C.yel : C.ink;
      s.style.opacity = i < done ? (i === done - 1 ? 1 : 0.85) : 0.4;
      s.style.outline = on ? `2px solid ${C.ink}` : 'none';
    });
    TICK.style.opacity = E.outCubic(inv(11.05, 11.3, t)) * (1 - E.inCubic(inv(13.45, 13.6, t)));
  }
}

export const OVERLAY_COLORS = C;

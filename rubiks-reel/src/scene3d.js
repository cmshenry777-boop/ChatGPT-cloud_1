import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { E, clamp, inv, track, rng, noise1, smooth } from './util.js';
import { CubeState, evalSchedule, cubieTransform, stickerFaces, pieceType, parseMove, scramble, AXES } from './cube.js';
import { MAIN_SCHEDULE, assemblyTimes } from './timeline.js';

export const W = 1080, H = 1920;
const D2R = Math.PI / 180;
const ISO = new THREE.Vector3(1, 1, 1).normalize();       // camera direction: true isometric
const CAM_R = new THREE.Vector3(1, 0, -1).normalize();     // screen-right in the iso view
const CAM_U = new THREE.Vector3(-1, 2, -1).normalize();    // screen-up in the iso view

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('gl');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 0);
renderer.autoClear = false;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(28, W / H, 0.5, 2000);

// ---------------------------------------------------------------- studio shading
// SwiftShader (CPU WebGL) can't afford IBL, so lighting is baked into two
// procedurally painted "matcaps": a diffuse key/fill map and an additive
// specular map (softbox + rim). The camera always looks down the iso axis, so a
// view-space light rig reads as a fixed studio setup.
function paintMatcap(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i + 0.5) / size * 2 - 1, y = 1 - (j + 0.5) / size * 2;
    const r2 = x * x + y * y;
    const z = Math.sqrt(Math.max(0, 1 - r2));
    const [r, gg, b] = fn(x, y, z, Math.sqrt(r2));
    const o = (j * size + i) * 4;
    img.data[o] = clamp(r) * 255; img.data[o + 1] = clamp(gg) * 255; img.data[o + 2] = clamp(b) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const nrm = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
const LK = nrm(-0.55, 0.6, 0.6), LF = nrm(0.85, -0.05, 0.5);
function diffuseShade(x, y, z) {
  const k = Math.max(0, x * LK[0] + y * LK[1] + z * LK[2]);
  const f = Math.max(0, x * LF[0] + y * LF[1] + z * LF[2]);
  let d = 0.504 + 0.568 * k + 0.104 * f;
  return d * (0.62 + 0.38 * smooth(0.0, 0.5, z));   // grazing bevels fall off → depth
}
const DIFFUSE = paintMatcap(256, (x, y, z) => { const d = diffuseShade(x, y, z); return [d, d * 0.995, d * 0.985]; });
// same light rig evaluated on the CPU for flat, unlit instanced geometry (the wall)
const s2l = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function shadeWorldNormal(n) {
  const d = diffuseShade(n.dot(CAM_R), n.dot(CAM_U), n.dot(ISO));
  return s2l(clamp(d));
}
const SPEC = paintMatcap(256, (x, y, z, r) => {
  // softbox key reflection, rotated ellipse up-left
  const ca = Math.cos(-0.6), sa = Math.sin(-0.6);
  const dx = x + 0.5, dy = y - 0.32;
  const u = (dx * ca - dy * sa) / 0.2, v = (dx * sa + dy * ca) / 0.1;
  const box = Math.exp(-Math.pow(u * u + v * v, 2.2));
  // rim light from behind-right, plus a soft top rim
  const rim = smooth(0.8, 0.97, r) * (0.35 + 0.65 * smooth(-0.2, 0.9, x * 0.7 + y * 0.5));
  // faint broad sheen so flat faces aren't dead
  const sheen = 0.05 * Math.exp(-((x + 0.2) ** 2 + (y - 0.45) ** 2) / 0.35);
  const s = 1.15 * box + 0.85 * rim + sheen;
  return [s, s, s * 1.02];
});
export const SHINE = { pos: { value: -9999 }, width: { value: 120 }, amt: { value: 0 } };
function studioMat(color, spec = 0.5) {
  const m = new THREE.MeshMatcapMaterial({ color, matcap: DIFFUSE });
  m.userData.spec = { value: spec };
  m.onBeforeCompile = sh => {
    sh.uniforms.specMap = { value: SPEC };
    sh.uniforms.specAmt = m.userData.spec;
    sh.uniforms.shinePos = SHINE.pos; sh.uniforms.shineW = SHINE.width; sh.uniforms.shineAmt = SHINE.amt;
    sh.fragmentShader = 'uniform sampler2D specMap; uniform float specAmt, shinePos, shineW, shineAmt;\n' + sh.fragmentShader.replace(
      'vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;',
      `vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
       outgoingLight += texture2D(specMap, uv).rgb * specAmt;
       float sb = (gl_FragCoord.x * 0.8 - gl_FragCoord.y) - shinePos;
       outgoingLight += vec3(1.0) * shineAmt * specAmt * exp(-sb * sb / (shineW * shineW));`);
  };
  m.customProgramCacheKey = () => 'studio';
  return m;
}

// soft contact shadow (painted blob, only reads on the light backgrounds)
const blobTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(0.65, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
})();
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTex, transparent: true, opacity: 0.2, depthWrite: false }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -2.9;
floor.renderOrder = -1;
scene.add(floor);

// ---------------------------------------------------------------- geometry
function roundedSquare(size, r) {
  const s = size / 2, sh = new THREE.Shape();
  sh.moveTo(-s + r, -s); sh.lineTo(s - r, -s); sh.quadraticCurveTo(s, -s, s, -s + r);
  sh.lineTo(s, s - r); sh.quadraticCurveTo(s, s, s - r, s); sh.lineTo(-s + r, s);
  sh.quadraticCurveTo(-s, s, -s, s - r); sh.lineTo(-s, -s + r); sh.quadraticCurveTo(-s, -s, -s + r, -s);
  return sh;
}
const bodyGeo = new RoundedBoxGeometry(0.965, 0.965, 0.965, 3, 0.11);
const stickerGeo = new THREE.ExtrudeGeometry(roundedSquare(0.8, 0.13), {
  depth: 0.006, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.022, bevelSegments: 2, curveSegments: 4,
});
const zAxis = new THREE.Vector3(0, 0, 1);
function stickerLocal(n, offset = 0.474) {
  const nv = new THREE.Vector3(...n);
  const q = new THREE.Quaternion().setFromUnitVectors(zAxis, nv);
  return { pos: nv.clone().multiplyScalar(offset), q };
}

// ---------------------------------------------------------------- hero cube
const BODY = new THREE.Color('#121215');
const GHOST_BODY = new THREE.Color('#cdc7bb');
const GHOST_STICK = new THREE.Color('#dcd6cb');

export const root = new THREE.Group();
scene.add(root);

const solved = new CubeState();
const state = new CubeState();
const ar = rng(7);
export const cubies = solved.c.map((k, i) => {
  const type = pieceType(k.home);
  const g = new THREE.Group();
  const ent = { k: state.c[i], home: k.home, type, g, stickers: [] };
  if (type !== 'core') {
    const bm = studioMat(BODY.clone(), 0.42);
    const body = new THREE.Mesh(bodyGeo, bm);
    g.add(body);
    ent.body = body;
    for (const f of stickerFaces(k.home)) {
      const base = new THREE.Color(f.col);
      const m = studioMat(base.clone(), 0.5);
      const st = new THREE.Mesh(stickerGeo, m);
      const L = stickerLocal(f.n);
      st.position.copy(L.pos); st.quaternion.copy(L.q);
      g.add(st);
      ent.stickers.push({ mesh: st, base });
    }
  }
  // fly-in start pose for the opening assembly
  const dir = new THREE.Vector3(ar() * 2 - 1, ar() * 2 - 1, ar() * 2 - 1).normalize();
  dir.add(new THREE.Vector3(...k.home).multiplyScalar(0.8)).normalize();
  ent.flyFrom = dir.multiplyScalar(11 + ar() * 5);
  ent.flyQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(ar() * 6, ar() * 6, ar() * 6));
  root.add(g);
  return ent;
});
const LAND = assemblyTimes(cubies, rng(11));
cubies.forEach((c, i) => { c.land = LAND[i]; });

// The core mechanism (three-axis spider), revealed by the exploded view.
const coreMat = studioMat(new THREE.Color('#1a1a1e'), 0.35);
const core = new THREE.Group();
core.add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 16), coreMat));
const arms = [0, 1, 2].map(ax => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 16), coreMat);
  if (ax === 0) m.rotation.z = Math.PI / 2;
  if (ax === 2) m.rotation.x = Math.PI / 2;
  core.add(m);
  return m;
});
root.add(core);

// Arc arrow that shows the direction of a turn (notation scene).
const arrowMat = new THREE.MeshBasicMaterial({ color: '#FFD400' });
const arrow = new THREE.Group();
const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 20), arrowMat);
let arrowArc = new THREE.Mesh(new THREE.BufferGeometry(), arrowMat);
arrow.add(arrowArc, arrowHead);
root.add(arrow);

// ---------------------------------------------------------------- the wall
// A honeycomb of scrambled cubes: in a true isometric view a cube's silhouette
// is a regular hexagon, so cubes tile the plane perpendicular to the view.
const EDGE = 3, HEXR = EDGE * Math.sqrt(2 / 3), GAP = 1.13;
const SX = Math.sqrt(3) * HEXR * GAP, SY = 1.5 * HEXR * GAP;
const NC = 10, NR = 18;
// sticker locals shared by every wall cube: [cubie index] → [{m, n, col}]
const CUBIE_STICKERS = solved.c.map(k => stickerFaces(k.home).map(f => {
  const L = stickerLocal(f.n, 0.48);
  return { m: new THREE.Matrix4().compose(L.pos, L.q, new THREE.Vector3(1, 1, 1)), n: new THREE.Vector3(...f.n), col: new THREE.Color(f.col) };
}));
// Only the three faces toward the camera can ever be seen on a resting cube.
const _vn = new THREE.Vector3();
function visibleStickers(st) {
  const out = [];
  st.c.forEach((cb, k) => {
    const cm = new THREE.Matrix4().compose(cb.p, cb.q, new THREE.Vector3(1, 1, 1));
    for (const s of CUBIE_STICKERS[k]) {
      _vn.copy(s.n).applyQuaternion(cb.q);
      if (_vn.x + _vn.y + _vn.z > 0.5) out.push({ m: cm.clone().multiply(s.m), col: s.col.clone().multiplyScalar(shadeWorldNormal(_vn)) });
    }
  });
  return out;
}
const wallCubes = [];
{
  const r = rng(99);
  for (let j = -NR; j <= NR; j++) for (let i = -NC; i <= NC; i++) {
    if (i === 0 && j === 0) continue;
    const x = SX * (i + ((j % 2) + 2) % 2 * 0.5), y = SY * j;
    const pos = CAM_R.clone().multiplyScalar(x).addScaledVector(CAM_U, y);
    const base = new CubeState();
    scramble(22 + Math.floor(r() * 6), 1000 + wallCubes.length).forEach(n => base.apply(parseMove(n)));
    // a share of the wall keeps twisting while we look at it
    const sched = [];
    if (r() < 0.3) {
      let t = 8.2 + r() * 1.0;
      const n = 1 + Math.floor(r() * 3);
      scramble(n, 5000 + wallCubes.length).forEach(mv => {
        const d = 0.2 + r() * 0.12;
        sched.push({ m: parseMove(mv), t0: t, t1: t + d, ease: E.inOutQuart, settle: 0.12 });
        t += d + 0.12 + r() * 0.45;
      });
    }
    const d = Math.hypot(x / SX, y / SY);
    wallCubes.push({ pos, base, sched, d, st: new CubeState().copy(base), seed: r(), vis: sched.length ? null : visibleStickers(base) });
  }
}
const DMAX = Math.max(...wallCubes.map(c => c.d));
// SwiftShader pays a heavy per-instance cost, so the whole wall is rebuilt each
// sample as ONE pre-shaded, unlit triangle soup (positions + colours).
const tplFrom = g => g.toNonIndexed().attributes.position.array;
const TPL_HI = tplFrom(new THREE.ShapeGeometry(roundedSquare(0.82, 0.14), 3));
const TPL_LO = tplFrom(new THREE.PlaneGeometry(0.8, 0.8));
const BOXG = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const TPL_BOX = BOXG.attributes.position.array, TPL_BOXN = BOXG.attributes.normal.array;
// the three camera-facing faces of a box (+x, +y, +z) — what a resting cube shows
const TPL_BOX3 = [], TPL_BOX3N = [];
for (let v = 0; v < TPL_BOX.length / 3; v++) {
  const nx = TPL_BOXN[v * 3], ny = TPL_BOXN[v * 3 + 1], nz = TPL_BOXN[v * 3 + 2];
  if (nx + ny + nz > 0.5) { TPL_BOX3.push(TPL_BOX[v * 3], TPL_BOX[v * 3 + 1], TPL_BOX[v * 3 + 2]); TPL_BOX3N.push(nx, ny, nz); }
}
const MAXV = 900000;
const wallGeo = new THREE.BufferGeometry();
const wPos = new Float32Array(MAXV * 3), wCol = new Float32Array(MAXV * 3);
wallGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3).setUsage(THREE.DynamicDrawUsage));
wallGeo.setAttribute('color', new THREE.BufferAttribute(wCol, 3).setUsage(THREE.DynamicDrawUsage));
export const wallGroup = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ vertexColors: true }));
wallGroup.frustumCulled = false;
scene.add(wallGroup);
const WALL_BODY = new THREE.Color('#141418');
const BODY_BIG = new THREE.Matrix4().makeScale(2.955, 2.955, 2.955);
const BODY_SMALL = new THREE.Matrix4().makeScale(0.955, 0.955, 0.955);
let wv = 0;
function emit(tpl, M, r, g, b) {
  const e = M.elements;
  for (let i = 0; i < tpl.length; i += 3) {
    const x = tpl[i], y = tpl[i + 1], z = tpl[i + 2], o = wv * 3;
    wPos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
    wPos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    wPos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    wCol[o] = r; wCol[o + 1] = g; wCol[o + 2] = b;
    wv++;
  }
}
const _bn = new THREE.Vector3();
function emitBox(tpl, tplN, M, q) {
  // per-face shading from the rotated face normal (6 verts per face)
  for (let f = 0; f < tpl.length / 18; f++) {
    _bn.set(tplN[f * 18], tplN[f * 18 + 1], tplN[f * 18 + 2]);
    if (q) _bn.applyQuaternion(q);
    const sh = shadeWorldNormal(_bn);
    emit(tpl.subarray ? tpl.subarray(f * 18, f * 18 + 18) : tpl.slice(f * 18, f * 18 + 18), M, WALL_BODY.r * sh, WALL_BODY.g * sh, WALL_BODY.b * sh);
  }
}
const TPL_BOX3F = new Float32Array(TPL_BOX3), TPL_BOX3NF = new Float32Array(TPL_BOX3N);

// ---------------------------------------------------------------- post: motion-blur accumulation
// no MSAA: the jittered blur samples already supersample (and MSAA is costly on SwiftShader)
const rtScene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
const rtAccum = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const accumMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: null }, w: { value: 1 } },
  vertexShader: VERT,
  fragmentShader: 'uniform sampler2D tex; uniform float w; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tex, vUv) * w; }',
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
});
const outMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: rtAccum.texture } },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tex; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tex, vUv);
      float a = clamp(c.a, 0.0, 1.0);
      vec3 col = a > 1e-4 ? c.rgb / a : vec3(0.0);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor = vec4(gl_FragColor.rgb * a, a);
    }`,
  blending: THREE.NoBlending, depthTest: false, depthWrite: false, toneMapped: true,
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), accumMat);
const quadScene = new THREE.Scene();
quadScene.add(quad);
quad.frustumCulled = false;

// ================================================================ animation
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _e = new THREE.Euler();
const ONE = new THREE.Vector3(1, 1, 1);

// --- camera ----------------------------------------------------------------
export function cameraState(t) {
  const logD = track(t, [
    [0.0, Math.log(44)], [1.3, Math.log(27), E.outExpo],
    [1.9, Math.log(26.5), E.lin], [2.45, Math.log(33), E.outExpo], [4.7, Math.log(34.5), E.lin], [5.04, Math.log(23), E.inOutExpo],
    [5.6, Math.log(21.5), E.outExpo], [7.0, Math.log(21.8), E.lin], [8.0, Math.log(18.5), E.inQuad],
    [9.3, Math.log(205), E.outExpo], [10.4, Math.log(172), E.inOutQuad], [11.0, Math.log(25), E.inExpo],
    [13.48, Math.log(26.5), E.lin], [14.25, Math.log(22.5), E.outExpo], [15.0, Math.log(21.8), E.lin],
  ]);
  const cy = track(t, [
    [0, 870], [2.0, 870], [2.4, 900, E.outExpo], [4.8, 900], [5.1, 860, E.inOutExpo],
    [7.9, 860], [8.6, 960, E.outExpo], [10.5, 960], [11.0, 1010, E.inOutExpo], [13.45, 1020],
    [13.9, 990, E.outExpo],
  ]);
  // rolling camera through the wall, shake building through the scramble
  const roll = track(t, [[8.0, 0], [9.4, -9 * D2R, E.outCubic], [10.4, -12 * D2R, E.lin], [11.0, 0, E.inExpo]]);
  const shakeAmp = track(t, [[7.0, 0], [7.95, 0.22, E.inQuad], [8.0, 0.0, E.lin]]) + track(t, [[13.5, 0.12], [13.9, 0, E.outCubic]]) * (t >= 13.5 ? 1 : 0);
  return { D: Math.exp(logD), cy, roll, shakeAmp };
}

const JIT = { x: 0, y: 0 };
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
export function placeCamera(t) {
  const c = cameraState(t);
  camera.position.copy(ISO).multiplyScalar(c.D);
  const sx = noise1(t * 22, 3) * c.shakeAmp, sy = noise1(t * 22, 9) * c.shakeAmp;
  const target = CAM_R.clone().multiplyScalar(sx).addScaledVector(CAM_U, sy);
  camera.position.add(target);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.rotateZ(c.roll);
  camera.setViewOffset(W, H, JIT.x, H / 2 - c.cy + JIT.y, W, H);
  camera.updateMatrixWorld();
  return c;
}

// --- hero root orientation ------------------------------------------------
function rootPose(t) {
  const yaw = track(t, [
    [0, -150], [1.3, 0, E.outCubic], [1.5, 0], [1.95, 90, E.inOutExpo],
    [4.62, 112, E.lin], [5.05, 360, E.inOutExpo],
    [7.0, 360], [8.0, 360],
    [11.0, 360], [13.5, 330, E.inOutQuad], [14.3, 720, E.outExpo], [15.0, 728, E.lin],
  ]);
  const pitch = track(t, [[0, 30], [1.3, 0, E.outCubic], [13.5, 0], [13.75, -8, E.outQuad], [14.4, 0, E.outBack]]);
  // scramble wobble: the cube gets "handled" while it is being mixed up
  const wob = smooth(7.0, 7.4, t) * (1 - smooth(7.85, 8.0, t));
  const wy = noise1(t * 6, 21) * 10 * wob, wx = noise1(t * 6, 22) * 8 * wob;
  const pulse = 1 + 0.06 * Math.exp(-Math.max(0, t - 13.5) * 9) * (t >= 13.5 ? 1 : 0)
                  + 0.04 * Math.exp(-Math.max(0, t - 5.0) * 12) * (t >= 5.0 ? 1 : 0);
  _e.set((pitch + wx) * D2R, (yaw + wy) * D2R, 0, 'YXZ');
  root.quaternion.setFromEuler(_e);
  root.scale.setScalar(pulse);
}

// --- anatomy (scene 2) ---------------------------------------------------
const PHASES = {
  center: [2.36, 3.16], edge: [3.16, 3.96], corner: [3.96, 4.66],
};
export function highlight(type, t) {
  const p = PHASES[type === 'core' ? 'center' : type];
  if (!p) return 0;
  return track(t, [[p[0] - 0.02, 0], [p[0] + 0.2, 1, E.outExpo], [p[1] - 0.04, 1], [p[1] + 0.14, 0, E.inOutCubic]]);
}
export function explodeAmt(t) {
  return track(t, [[2.0, 0], [2.42, 1, E.outExpo], [4.72, 1], [5.0, 0, E.inExpo]]);
}
function ghostMode(t) { return track(t, [[2.22, 0], [2.42, 1, E.outCubic], [4.42, 1], [4.62, 0, E.inOutCubic]]); }

// --- update ---------------------------------------------------------------
const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion();
const _fp = new THREE.Vector3(), _fq = new THREE.Quaternion();
export function update3D(t) {
  const cam = placeCamera(t);
  rootPose(t);

  // victory glint: a diagonal light band sweeps across the solved cube
  SHINE.pos.value = track(t, [[13.6, -1350], [14.3, 200, E.inOutCubic]]);
  SHINE.amt.value = t > 13.6 && t < 14.4 ? 1.6 : 0;

  const partial = evalSchedule(state, solved, MAIN_SCHEDULE, t);
  const ex = explodeAmt(t), gm = ghostMode(t);
  const spread = 1 + 0.46 * ex;

  for (const c of cubies) {
    cubieTransform(state, c.k, partial, _pos, _quat);
    // anatomy: explode, then pop the highlighted family further out
    if (ex > 0) {
      const h = highlight(c.type, t);
      _pos.multiplyScalar(spread);
      if (c.type !== 'core' && h > 0) _p.copy(_pos).normalize().multiplyScalar(0.62 * h), _pos.add(_p);
      const g = gm * (1 - h);
      if (c.body) {
        c.body.material.color.copy(BODY).lerp(GHOST_BODY, g);
        for (const s of c.stickers) s.mesh.material.color.copy(s.base).lerp(GHOST_STICK, g);
      }
    } else if (c.body && c.body.material.color.r !== BODY.r) {
      c.body.material.color.copy(BODY);
      for (const s of c.stickers) s.mesh.material.color.copy(s.base);
    }
    // opening assembly: pieces streak in and magnetically snap home
    let sc = 1, vis = true;
    if (t < c.land + 0.3) {
      const FL = 0.46;
      const x = inv(c.land - FL, c.land, t);
      vis = t > c.land - FL;
      const e = E.inQuad(x) * 0.25 + E.inOutCubic(x) * 0.75;
      _fp.copy(c.flyFrom).multiplyScalar(1 - e);
      _pos.add(_fp);
      _fq.copy(c.flyQ).slerp(_quat, E.outCubic(Math.min(1, x * 1.25)));
      _quat.copy(_fq);
      // tiny recoil on impact
      const after = t - c.land;
      if (after > 0) sc = 1 + 0.07 * Math.exp(-after * 22) * Math.sin(after * 60);
    }
    c.g.visible = vis;
    c.g.position.copy(_pos);
    c.g.quaternion.copy(_quat);
    c.g.scale.setScalar(sc);
  }

  // core spider: arms stretch with the exploded centers
  const coreVis = t > cubies.find(c => c.type === 'core').land - 0.46;
  core.visible = coreVis;
  core.position.copy(cubies.find(c => c.type === 'core').g.position);
  core.quaternion.copy(cubies.find(c => c.type === 'core').g.quaternion);
  const hc = highlight('center', t);
  const armLen = 2 * (spread + 0.62 * hc) - 0.5;
  arms.forEach(a => a.scale.set(1, armLen, 1));
  coreMat.color.set('#1a1a1e').lerp(GHOST_BODY, gm * (1 - hc));

  updateArrow(t);
  updateWall(t);

  floor.material.opacity = track(t, [[2.0, 0.0], [2.3, 0.2], [4.75, 0.2], [4.95, 0.0], [11.0, 0.0], [11.3, 0.24], [13.5, 0.24], [13.6, 0]]);
  floor.visible = floor.material.opacity > 0.001;
  floor.position.y = -1.75 - 1.1 * spread;
  floor.scale.set(5.2 * spread, 5.2 * spread, 1);
  return cam;
}

// --- notation arrow -------------------------------------------------------
const DEMO_SCHED = MAIN_SCHEDULE.filter(s => s.kind === 'demo');
function updateArrow(t) {
  const s = DEMO_SCHED.find(s => t > s.t0 - 0.06 && t < s.t1 + 0.26);
  arrow.visible = !!s;
  if (!s) return;
  const sign = s.m.angle > 0 ? 1 : -1;
  const start = sign > 0 ? 0 : Math.PI / 2;
  const head = start + sign * (Math.PI / 2) * E.outCubic(inv(s.t0 - 0.06, s.t1 - 0.02, t)) * 1.06;
  const tail = start + sign * (Math.PI / 2) * E.inOutCubic(inv(s.t1 - 0.02, s.t1 + 0.24, t)) * 1.06;
  const a0 = Math.min(head, tail), a1 = Math.max(head, tail);
  const R = 2.36;
  arrowArc.geometry.dispose();
  arrowArc.geometry = new THREE.TorusGeometry(R, 0.055, 10, 64, Math.max(0.001, a1 - a0));
  // basis: local X → e1, Y → e2, Z → axis
  const ax = s.m.axis;
  const e1 = AXES[(ax + 1) % 3], e2 = AXES[(ax + 2) % 3], n = AXES[ax];
  _m.makeBasis(e1, e2, n);
  arrow.quaternion.setFromRotationMatrix(_m);
  arrow.position.copy(n).multiplyScalar(s.m.layer * 1.0);
  arrowArc.rotation.z = a0;
  arrowHead.position.set(Math.cos(head) * R, Math.sin(head) * R, 0);
  // cone points +Y; aim it along the tangent of travel
  const tang = new THREE.Vector3(-Math.sin(head), Math.cos(head), 0).multiplyScalar(sign);
  arrowHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tang);
  const hs = clamp((a1 - a0) / 0.35) * (1 - smooth(s.t1 + 0.12, s.t1 + 0.26, t));
  arrowHead.scale.setScalar(Math.max(0.001, hs));
  arrowArc.visible = a1 - a0 > 0.01;
}

// --- the wall -------------------------------------------------------------
const _cp = new THREE.Vector3(), _cq = new THREE.Quaternion(), _qI = new THREE.Quaternion();
const _vp = new THREE.Matrix4(), _v = new THREE.Vector3(), _wp = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
function updateWall(t) {
  const on = t > 7.98 && t < 11.02;
  wallGroup.visible = on;
  if (!on) return;
  camera.updateMatrixWorld();
  _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const rN = 2.75 / (camera.position.length() * Math.tan(14 * D2R));
  wv = 0;
  for (const wc of wallCubes) {
    // bloom in: a ripple from the hero outward
    const t0 = 8.0 + wc.d * 0.016 + wc.seed * 0.05;
    let sc = E.outBack(clamp(inv(t0, t0 + 0.42, t)), 1.9);
    // implosion back into the hero: every state collapses into one
    const i0 = 10.36 + 0.3 * (1 - wc.d / DMAX) + wc.seed * 0.06;
    const ip = inv(i0, 10.98, t);
    sc *= 1 - E.inCubic(ip) * 0.92;
    if (sc < 0.002) continue;
    _wp.copy(wc.pos).multiplyScalar(1 - E.inQuart(ip));
    _v.copy(_wp).applyMatrix4(_vp);
    const rr = rN * sc;
    if (Math.abs(_v.y) > 1 + rr || Math.abs(_v.x) > 1 + rr * (H / W)) continue;
    if (wv > MAXV - 6000) break;
    _m2.compose(_wp, _qI, _s.setScalar(sc));
    const TPL = rr > 0.05 ? TPL_HI : TPL_LO;
    const partial = wc.sched.length ? evalSchedule(wc.st, wc.base, wc.sched, t) : null;
    if (!partial) {
      const vis = wc.vis || visibleStickers(wc.st);
      _m.multiplyMatrices(_m2, BODY_BIG);
      emitBox(TPL_BOX3F, TPL_BOX3NF, _m, null);
      for (const v of vis) { _m.multiplyMatrices(_m2, v.m); emit(TPL, _m, v.col.r, v.col.g, v.col.b); }
    } else {
      for (let k = 0; k < 27; k++) {
        const cb = wc.st.c[k];
        cubieTransform(wc.st, cb, partial, _cp, _cq);
        _m3.compose(_cp, _cq, ONE).premultiply(_m2);
        if (k !== 13) { _m.multiplyMatrices(_m3, BODY_SMALL); emitBox(TPL_BOX, TPL_BOXN, _m, _cq); }
        for (const s of CUBIE_STICKERS[k]) {
          _vn.copy(s.n).applyQuaternion(_cq);
          if (_vn.x + _vn.y + _vn.z < -0.5) continue;
          _m.multiplyMatrices(_m3, s.m);
          const sh = shadeWorldNormal(_vn);
          emit(TPL, _m, s.col.r * sh, s.col.g * sh, s.col.b * sh);
        }
      }
    }
  }
  wallGeo.setDrawRange(0, wv);
  wallGeo.attributes.position.needsUpdate = true;
  wallGeo.attributes.color.needsUpdate = true;
  wallGeo.attributes.position.updateRanges.length = 0;
  wallGeo.attributes.position.addUpdateRange(0, wv * 3);
  wallGeo.attributes.color.updateRanges.length = 0;
  wallGeo.attributes.color.addUpdateRange(0, wv * 3);
}

// --- projection helper (for 2D callouts that track 3D pieces) --------------
export function project(obj) {
  obj.getWorldPosition(_p);
  _p.project(camera);
  return { x: (_p.x * 0.5 + 0.5) * W, y: (-_p.y * 0.5 + 0.5) * H, z: _p.z };
}
export function worldFacing(obj) {
  obj.getWorldPosition(_p);
  return _p.clone().normalize().dot(camera.position.clone().normalize());
}

// --- render a frame with optional motion blur ------------------------------
export function render3D(t, samples = 1, shutter = 0.5, fps = 60) {
  root.updateMatrixWorld(true);
  for (let i = 0; i < samples; i++) {
    const ts = samples === 1 ? t : t + shutter * (i / (samples - 1) - 0.5) / fps;
    // sub-pixel jitter: the blur samples double as supersampling AA
    JIT.x = samples === 1 ? 0 : halton(i + 1, 2) - 0.5;
    JIT.y = samples === 1 ? 0 : halton(i + 1, 3) - 0.5;
    update3D(ts);
    scene.updateMatrixWorld(true);
    renderer.setRenderTarget(rtScene);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.setRenderTarget(rtAccum);
    if (i === 0) renderer.clear(true, false, false);
    quad.material = accumMat;
    accumMat.uniforms.tex.value = rtScene.texture;
    accumMat.uniforms.w.value = 1 / samples;
    renderer.render(quadScene, quadCam);
  }
  // leave the scene posed at the frame's centre time for overlay projections
  JIT.x = JIT.y = 0;
  if (samples > 1) update3D(t);
  scene.updateMatrixWorld(true);
  renderer.setRenderTarget(null);
  renderer.clear(true, true, true);
  quad.material = outMat;
  renderer.render(quadScene, quadCam);
}

export function cubieByHome(x, y, z) {
  return cubies.find(c => c.home[0] === x && c.home[1] === y && c.home[2] === z);
}

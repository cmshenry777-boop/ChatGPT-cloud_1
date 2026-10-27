// Small synthesized sound effects (no audio files to download).
// Browsers only allow audio after the first tap, so everything here fails quietly before that.

let ctx = null;

function audio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Call from a tap handler so later sounds are allowed to play.
export function unlockAudio() { audio(); }

function tone(a, freq, start, dur, { type = 'sine', gain = 0.15, endFreq } = {}) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(a.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

function noise(a, start, dur, { freq = 2500, q = 1.2, gain = 0.3, type = 'bandpass', endFreq } = {}) {
  const len = Math.ceil(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, start);
  if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(start);
}

const SOUNDS = {
  // a card slapped on the table, one snap per card
  play(a, t, n = 1) { for (let i = 0; i < n; i++) noise(a, t + i * 0.045, 0.07, { freq: 2200 + i * 150, gain: 0.35 }); },
  select(a, t) { tone(a, 1900, t, 0.04, { type: 'triangle', gain: 0.05 }); },
  pass(a, t) { tone(a, 392, t, 0.11, { type: 'triangle', gain: 0.12 }); tone(a, 294, t + 0.1, 0.16, { type: 'triangle', gain: 0.12 }); },
  turn(a, t) { tone(a, 1318, t, 0.45, { gain: 0.12 }); tone(a, 1976, t + 0.05, 0.4, { gain: 0.06 }); },
  sweep(a, t) { noise(a, t, 0.3, { type: 'lowpass', freq: 3000, endFreq: 400, q: 0.7, gain: 0.25 }); },
  deal(a, t) { for (let i = 0; i < 8; i++) noise(a, t + i * 0.055, 0.05, { freq: 2600, gain: 0.18 }); },
  error(a, t) { tone(a, 180, t, 0.18, { type: 'square', gain: 0.05 }); },
  win(a, t) { [523, 659, 784, 1046].forEach((f, i) => tone(a, f, t + i * 0.11, 0.35, { type: 'triangle', gain: 0.13 })); },
  lose(a, t) { [392, 330, 262].forEach((f, i) => tone(a, f, t + i * 0.14, 0.3, { type: 'triangle', gain: 0.11 })); },
};

export function sfx(name, arg) {
  const a = audio();
  if (!a || a.state !== 'running') return;
  try { SOUNDS[name](a, a.currentTime + 0.01, arg); } catch { /* ignore */ }
}

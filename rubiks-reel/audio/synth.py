"""Sound design for the reel, synthesized from scratch (numpy/scipy, no samples).

Every cube event in the picture comes from out/cues.json (exported by the renderer),
so each turn, snap and solve note lands on the exact frame it is seen.
Musical bed: 120 BPM, A minor → resolves to A major the moment the cube is solved.
"""
import json, os, sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
DUR = 15.0
N = int(SR * DUR)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cues = json.load(open(os.path.join(ROOT, 'out', 'cues.json')))
EV = cues['events']
rng = np.random.default_rng(1974)

# ------------------------------------------------------------------ busses
dry = np.zeros((N, 2))
send = np.zeros((N, 2))          # → reverb


def place(sig, t, gain=1.0, pan=0.0, rev=0.0):
    """Mix a mono (or stereo) signal in at time t (seconds)."""
    i0 = int(round(t * SR))
    if sig.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l, sig * r], 1) * np.sqrt(2)
    if i0 < 0:
        sig, i0 = sig[-i0:], 0
    n = min(len(sig), N - i0)
    if n <= 0:
        return
    dry[i0:i0 + n] += sig[:n] * gain
    if rev:
        send[i0:i0 + n] += sig[:n] * gain * rev


def env_exp(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


def tt(d):
    return np.arange(int(d * SR)) / SR


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'bandpass', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'highpass', fs=SR, output='sos'), x)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'lowpass', fs=SR, output='sos'), x)


def noise(d):
    return rng.standard_normal(int(d * SR))


def saw(freq, d, phase=0.0):
    """Band-limited (polyBLEP) sawtooth."""
    n = int(d * SR)
    dt = freq / SR
    ph = (phase + dt * np.arange(n)) % 1.0
    y = 2 * ph - 1
    m = ph < dt
    x = ph[m] / dt
    y[m] -= x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt
    y[m] -= x * x + x + x + 1
    return y


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def svf_sweep(x, f0, f1, q=2.0, curve=1.0):
    """Time-varying state-variable band-pass (for whooshes / risers)."""
    n = len(x)
    f = f0 * (f1 / f0) ** (np.linspace(0, 1, n) ** curve)
    g = np.tan(np.pi * np.minimum(f, SR * 0.45) / SR)
    k = 1.0 / q
    a1 = 1 / (1 + g * (g + k))
    ic1 = ic2 = 0.0
    out = np.empty(n)
    for i in range(n):
        v3 = x[i] - ic2
        v1 = a1[i] * ic1 + g[i] * a1[i] * v3
        v2 = ic2 + g[i] * v1
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        out[i] = v1
    return out


# ------------------------------------------------------------------ instruments
def kick(level=1.0, pitch=1.0):
    d = 0.45
    t = tt(d)
    f = (48 + 110 * np.exp(-t / 0.032)) * pitch
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * env_exp(len(t), 0.16)
    click = hp(noise(0.006), 2500) * 0.35
    body[:len(click)] += click
    return np.tanh(body * 1.6) * level


def sub_boom(d=1.6, f0=52, f1=36):
    t = tt(d)
    f = f1 + (f0 - f1) * np.exp(-t / 0.25)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(len(t), 0.55)
    y[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
    return np.tanh(y * 1.8)


def hat(d=0.035, tone=8000):
    x = hp(noise(d + 0.01), tone, 4)[: int(d * SR)]
    return x * env_exp(len(x), d / 3.5)


def crash(d=2.2):
    x = hp(noise(d), 4500, 2) * env_exp(int(d * SR), 0.55)
    x += bp(noise(d), 2500, 7000) * env_exp(int(d * SR), 0.18) * 0.6
    return x * 0.5


def clap():
    x = bp(noise(0.25), 900, 4200, 2)
    e = np.zeros(len(x))
    for k, o in enumerate([0, 0.011, 0.022]):
        i = int(o * SR)
        e[i:] += env_exp(len(x) - i, 0.006 if k < 2 else 0.07)
    return x * e * 0.6


def clack(strength=1.0, pitch=1.0):
    """Plastic cube turn landing: bright click + two resonant body modes + thump."""
    d = 0.09
    n = int(d * SR)
    t = np.arange(n) / SR
    click = bp(noise(d), 2200, 7500) * env_exp(n, 0.0035)
    f1 = 1180 * pitch * (1 + rng.uniform(-0.04, 0.04))
    body = (np.sin(2 * np.pi * f1 * t) * env_exp(n, 0.011)
            + 0.55 * np.sin(2 * np.pi * f1 * 2.31 * t) * env_exp(n, 0.006))
    thump = np.sin(2 * np.pi * 190 * t) * env_exp(n, 0.018)
    return (click * 0.9 + body * 0.32 + thump * 0.45) * strength


def swish(d, level=0.2):
    """The air of a layer turning (quiet, rises into the clack)."""
    n = int(d * SR)
    x = bp(noise(d), 900, 5000) * np.linspace(0, 1, n) ** 2
    return x * level


def snap(pitch):
    d = 0.05
    n = int(d * SR)
    t = np.arange(n) / SR
    tick = np.sin(2 * np.pi * pitch * t) * env_exp(n, 0.008)
    return tick * 0.5 + bp(noise(d), 3000, 9000) * env_exp(n, 0.002) * 0.6


def mallet(freq, d=0.9, level=1.0):
    """Marimba-like tone for the solve run (plastic, woody)."""
    n = int(d * SR)
    t = np.arange(n) / SR
    y = (np.sin(2 * np.pi * freq * t) * env_exp(n, 0.32)
         + 0.42 * np.sin(2 * np.pi * freq * 3.93 * t) * env_exp(n, 0.05)
         + 0.12 * np.sin(2 * np.pi * freq * 9.2 * t) * env_exp(n, 0.012))
    a = int(0.002 * SR)
    y[:a] *= np.linspace(0, 1, a)
    return y * level


def pluck_bass(freq, d=0.24, level=1.0, cutoff=900):
    x = saw(freq, d) * 0.6 + np.sin(2 * np.pi * freq * tt(d)) * 0.8
    x = lp(x, cutoff, 2) * env_exp(len(x), d / 2.5)
    return np.tanh(x * 1.5) * level


def pad(notes, d, cutoff=1800, attack=0.25, release=0.5, level=1.0):
    n = int((d + release) * SR)
    out = np.zeros((n, 2))
    for m in notes:
        f = midi(m)
        for det, pan in [(-0.11, -0.7), (0.0, 0.0), (0.12, 0.7)]:
            v = saw(f * 2 ** (det / 12), d + release, rng.uniform())
            l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            out[:, 0] += v * l
            out[:, 1] += v * r
    out = np.stack([hp(lp(out[:, 0], cutoff, 2), 130), hp(lp(out[:, 1], cutoff, 2), 130)], 1)
    e = np.ones(n)
    a = int(attack * SR)
    e[:a] = np.linspace(0, 1, a) ** 1.5
    rs = int(d * SR)
    e[rs:] = np.linspace(1, 0, n - rs) ** 2
    return out * e[:, None] * level / (len(notes) * 3) ** 0.5


def whoosh(d, f0, f1, level=1.0, q=1.6, pan0=0.0, pan1=0.0, shape='swell'):
    n = int(d * SR)
    x = svf_sweep(noise(d), f0, f1, q)
    u = np.linspace(0, 1, n)
    e = np.sin(np.pi * u) ** 1.5 if shape == 'swell' else u ** 2.5
    x = x * e
    pans = np.linspace(pan0, pan1, n)
    l, r = np.cos((pans + 1) * np.pi / 4), np.sin((pans + 1) * np.pi / 4)
    return np.stack([x * l, x * r], 1) * np.sqrt(2) * level


def blips(t0, d, seed):
    """Data chirps for the decoding HUD labels."""
    r = np.random.default_rng(seed)
    k = 0.0
    while k < d:
        f = r.choice([1800, 2400, 3200, 4100])
        dd = r.uniform(0.012, 0.025)
        y = np.sign(np.sin(2 * np.pi * f * tt(dd))) * env_exp(int(dd * SR), dd / 3)
        place(lp(y, 6000), t0 + k, 0.035, pan=r.uniform(-0.5, 0.5))
        k += r.uniform(0.02, 0.05)


# ================================================================== SCORE
B = 0.5  # one beat at 120 BPM

# ---- music bed: chords (MIDI) ------------------------------------------------
A1, A2 = 33, 45
CH = [
    (0.0, 2.0, [45, 52, 57, 60, 64], 1300, 0.6),        # Am
    (2.0, 3.0, [41, 48, 57, 60, 64], 1600, 0.25),       # Fmaj7
    (5.0, 2.0, [48, 55, 64, 67], 1800, 0.2),            # C
    (7.0, 1.0, [40, 47, 56, 59, 64], 2600, 0.15),       # E (tension)
    (8.0, 3.0, [45, 52, 57, 60, 64, 69], 1100, 0.2),    # Am — vast
    (11.0, 1.5, [41, 53, 57, 60, 65], 2000, 0.05),      # F
    (12.5, 1.0, [40, 52, 56, 59, 64], 2600, 0.05),      # E (dominant)
    (13.5, 1.5, [45, 52, 61, 64, 69, 73], 3200, 0.02),  # A major — solved
]
for t0, d, notes, cut, att in CH:
    g = 0.16 if t0 != 13.5 else 0.24
    place(pad(notes, d, cut, att, 0.5), t0, g, rev=0.55)
# sub drone under the vast states scene
place(np.sin(2 * np.pi * midi(A1) * tt(3.0)) * np.minimum(1, tt(3.0) / 0.3) * np.minimum(1, (3.0 - tt(3.0)) / 0.4), 8.0, 0.22)

# ---- drums ------------------------------------------------------------------
kicks = [0.5, 0.75, 1.0, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0,
         8.0, 9.0, 10.0, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5]
for k in kicks:
    lvl = 0.95 if k in (0.5, 0.75, 1.0, 8.0, 11.0, 13.5, 5.0) else 0.78
    place(kick(lvl), k, 0.78)
for i in range(int(2.0 / 0.25), int(7.0 / 0.25)):        # hats: scenes 2–3
    t = i * 0.25
    if abs((t / B) % 1 - 0.5) < 1e-6:
        place(hat(0.05), t, 0.16, pan=0.25)
    elif t >= 5.0:
        place(hat(0.025), t, 0.07, pan=-0.2)
for i in range(int(11.0 / 0.125), int(13.5 / 0.125)):    # hats: scene 5 drive
    t = i * 0.125
    place(hat(0.03 if i % 2 else 0.045), t, 0.1 if i % 4 == 2 else 0.055, pan=0.2 if i % 2 else -0.2)
for t in [9.5, 12.0, 13.0]:
    place(clap(), t, 0.42, rev=0.4)

# ---- bass ---------------------------------------------------------------------
for i in range(int(2.0 / 0.25), int(7.0 / 0.25)):
    t = i * 0.25
    root = 41 if t < 5.0 else 36
    place(pluck_bass(midi(root + (12 if i % 4 == 3 else 0)), 0.22, 1.0, 700), t, 0.26)
for i in range(int(11.0 / 0.25), int(13.5 / 0.25)):
    t = i * 0.25
    root = 29 if t < 12.5 else 28
    place(pluck_bass(midi(root + 12 + (12 if i % 2 else 0)), 0.2, 1.0, 1100), t, 0.3)

# ---- impacts --------------------------------------------------------------------
place(sub_boom(1.8), 8.0, 0.6)
place(crash(2.4), 8.0, 0.34, rev=0.5)
place(sub_boom(1.6, 58, 41), 13.5, 0.62)
place(crash(2.0), 13.5, 0.36, rev=0.6)
place(sub_boom(0.6, 70, 48), 5.0, 0.3)         # anatomy implodes back into a cube
place(sub_boom(0.7, 64, 44), 11.0, 0.4)        # all states collapse into one

# ---- whooshes ---------------------------------------------------------------------
place(whoosh(0.9, 300, 3500, 0.5, pan0=-0.6, pan1=0.6), -0.05, 0.6, rev=0.3)       # fly-in
place(whoosh(0.5, 600, 5000, 0.5), 1.48, 0.55)                                       # punctuation spin
place(whoosh(0.4, 2500, 600, 0.55, pan0=-0.5, pan1=0.6), 1.7, 0.55)                  # sticker wipe
place(whoosh(0.45, 900, 3000, 0.5), 2.0, 0.4)                                        # explode
place(whoosh(0.4, 4000, 700, 0.55, pan0=0.6, pan1=-0.6), 4.74, 0.55)                 # slab wipe + implode
place(whoosh(1.4, 3000, 220, 0.7), 8.0, 0.65, rev=0.5)                               # pull back
place(whoosh(0.62, 300, 5200, 0.8, shape='rise'), 10.42, 0.7, rev=0.3)               # implosion (reverse)
place(whoosh(0.36, 1200, 3800, 0.45, pan0=-0.7, pan1=0.7), 10.72, 0.5)               # column wipe
place(whoosh(0.5, 3500, 800, 0.5), 13.5, 0.45, rev=0.4)                              # radial burst

# ---- riser into the drop (accelerating scramble) ---------------------------------
d = 1.0
r = svf_sweep(noise(d), 300, 6000, 2.5, 0.7) * np.linspace(0, 1, int(d * SR)) ** 2.2
sweep = np.sin(2 * np.pi * np.cumsum(np.geomspace(180, 1400, int(d * SR))) / SR) * np.linspace(0, 1, int(d * SR)) ** 3
place(r * 0.55 + sweep * 0.12, 7.0, 0.8, rev=0.3)

# ---- cube events from the picture ----------------------------------------------
PENTA = [0, 3, 5, 7, 10]
snaps = [e for e in EV if e['k'] == 'snap']
for i, e in enumerate(snaps):
    step = PENTA[i % 5] + 12 * (i // 5)
    place(snap(midi(84 + step * 0.5)), e['t'], 0.16, pan=rng.uniform(-0.6, 0.6))

SCALE = [0, 2, 3, 5, 7, 8, 10]  # A natural minor
for e in EV:
    if e['k'] != 'turn':
        continue
    kind, idx = e['kind'], e['idx']
    if kind == 'demo':
        place(swish(e['dur'], 0.18), e['t0'], 1.0)
        place(clack(1.0, 1.0), e['t'], 1.0)
    elif kind == 'scramble':
        place(clack(0.85, 1.0 + idx * 0.025), e['t'], 0.82, pan=rng.uniform(-0.4, 0.4))
    elif kind == 'solve':
        place(clack(0.75, 1.05), e['t'], 0.66, pan=rng.uniform(-0.3, 0.3))
        dgr = 2 + idx                                 # C3 … A5: lands on the tonic at 20
        m = A2 + 12 * (dgr // 7) + SCALE[dgr % 7]
        if idx == 19:
            m = A2 + 36
        place(mallet(midi(m), 0.8 if idx < 19 else 2.2, 1.0), e['t'], 0.2 if idx < 19 else 0.32, pan=-0.5 + idx / 19, rev=0.35)

# rolling digits lock one by one, panned left → right across the number
for i in range(20):
    t = 8.3 + i * 0.052
    place(snap(midi(96 + (i % 4) * 2)), t, 0.1, pan=-0.7 + 1.4 * (i % 10) / 9)
# counter clicks on the 1.4 trillion years / label plates
for t in [8.08, 8.15, 8.22, 9.3, 9.62]:
    place(hat(0.02, 5000), t, 0.14)

# HUD decode chirps
for i, t in enumerate([0.06, 2.1, 5.1, 8.12, 11.06, 14.0]):
    blips(t, 0.38, 100 + i)

# type slams
for t in [0.1, 0.2]:
    place(kick(0.4, 1.8), t, 0.35)

# ================================================================== MIX
ir_len = int(1.9 * SR)
ir = rng.standard_normal((ir_len, 2)) * np.exp(-np.arange(ir_len) / (0.42 * SR))[:, None]
ir[:, 0] = lp(hp(ir[:, 0], 250), 6500)
ir[:, 1] = lp(hp(ir[:, 1], 250), 6500)
ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([fftconvolve(send[:, 0], ir[:, 0])[:N], fftconvolve(send[:, 1], ir[:, 1])[:N]], 1)
mix = dry + wet * 0.55

# gentle glue: soft-knee saturation, then peak normalise to -1 dBFS
mix = hp(mix.T, 28, 2).T
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
# fade in/out to match the picture (loops cleanly back to black)
fi, fo = int(0.03 * SR), int(0.3 * SR)
mix[:fi] *= np.linspace(0, 1, fi)[:, None]
mix[-fo:] *= (np.linspace(1, 0, fo) ** 1.5)[:, None]
peak = np.abs(mix).max()
mix *= 10 ** (-1 / 20) / peak
rms = 20 * np.log10(np.sqrt((mix ** 2).mean()))
print(f'peak -1.0 dBFS, rms {rms:.1f} dBFS')

out = os.path.join(ROOT, 'out', 'audio.wav')
pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2')
import wave
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote', out)

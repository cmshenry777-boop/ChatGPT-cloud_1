// Deterministic frame renderer: headless Chromium + WebGL (SwiftShader) → PNG frames.
//   node render.mjs --stills 0.5,2.8,9.1          # preview stills → out/stills/
//   node render.mjs --all --workers 4              # every frame → out/frames/
//   node render.mjs --cues                         # sound cue sheet → out/cues.json
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'out');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const has = k => args.includes(k);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.woff2': 'font/woff2', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--font-render-hinting=none'],
});

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.REEL);
  await page.evaluate(() => window.REEL.ready);
  return page;
}
async function shoot(page, t, file, samples) {
  await page.evaluate(([t, s]) => window.REEL.renderAt(t, s ? { samples: s } : {}), [t, samples]);
  await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } });
}

fs.mkdirSync(OUT, { recursive: true });
const FPS = 60, N = 900;

if (has('--cues')) {
  const page = await openPage();
  const cues = await page.evaluate(() => window.REEL.cues());
  fs.writeFileSync(path.join(OUT, 'cues.json'), JSON.stringify(cues, null, 1));
  console.log('cues:', cues.events.length);
}

if (has('--stills')) {
  const dir = path.join(OUT, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  const page = await openPage();
  const samples = arg('--samples') ? +arg('--samples') : undefined;
  for (const ts of arg('--stills').split(',')) {
    const t = +ts, t0 = Date.now();
    const f = path.join(dir, `t${t.toFixed(3).padStart(6, '0')}.png`);
    await shoot(page, t, f, samples);
    console.log(`still t=${t} → ${path.basename(f)} (${Date.now() - t0} ms)`);
  }
}

if (has('--all')) {
  const dir = path.join(OUT, 'frames');
  fs.mkdirSync(dir, { recursive: true });
  const workers = +arg('--workers', 3);
  const from = +arg('--from', 0), to = +arg('--to', N);
  const todo = [];
  for (let f = from; f < to; f++) {
    const file = path.join(dir, `f${String(f).padStart(4, '0')}.png`);
    if (!has('--force') && fs.existsSync(file)) continue;
    todo.push(f);
  }
  let next = 0, done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: workers }, async () => {
    const page = await openPage();
    while (next < todo.length) {
      const f = todo[next++];
      await shoot(page, f / FPS, path.join(dir, `f${String(f).padStart(4, '0')}.png`));
      done++;
      if (done % 20 === 0 || done === todo.length) {
        const el = (Date.now() - t0) / 1000;
        console.log(`${done}/${todo.length} frames · ${(el / done).toFixed(2)} s/frame · eta ${((todo.length - done) * el / done / 60).toFixed(1)} min`);
      }
    }
  }));
}

await browser.close();
server.close();

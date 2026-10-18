// Снимки сайта через Edge без окна: node tools/shot.mjs <url> <ширина> <высота> <папка> [js]
// Прокручивает страницу экранами и сохраняет каждый экран в JPEG, плюс ошибки консоли.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [url, w = '1440', h = '900', outDir = 'shots', extraJs = ''] = process.argv.slice(2);
const width = Number(w), height = Number(h);
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9300 + Math.floor(Math.random() * 400);
const profile = join(tmpdir(), 'eli-edge-' + port);
mkdirSync(outDir, { recursive: true });

const proc = spawn(edge, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', `--window-size=${width},${height}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {}
}
if (!target) { console.error('Edge не запустился'); proc.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push('exception: ' + msg.params.exceptionDetails.exception?.description);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    errors.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push('log: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
});
const send = (method, params = {}) => new Promise((resolve) => {
  const mid = ++id;
  pending.set(mid, resolve);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return res.result?.result?.value;
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
if (width < 768) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });
for (let i = 0; i < 75; i++) {
  await sleep(200);
  if (await evaluate("location.href !== 'about:blank' && document.readyState === 'complete'")) break;
}
await sleep(1200);

if (extraJs) console.log('js:', JSON.stringify(await evaluate(extraJs)));

const total = await evaluate('document.documentElement.scrollHeight');
const info = await evaluate('({w: innerWidth, sw: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})');
console.log('страница:', JSON.stringify(info));

let n = 0;
for (let y = 0; y < total; y += Math.round(height * 0.9)) {
  await evaluate(`window.scrollTo({top: ${y}, behavior: 'instant'})`);
  await sleep(1400);
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
  writeFileSync(join(outDir, String(++n).padStart(2, '0') + '.jpg'), Buffer.from(shot.result.data, 'base64'));
}

console.log('снимков:', n);
console.log('ошибки:', errors.length ? '\n' + errors.join('\n') : 'нет');
ws.close();
proc.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);

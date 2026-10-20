// Подарочный сертификат: PDF для печати и картинка для мессенджера, с номером и сроком.
//
//   node tools/certificate.mjs --lessons 10 --to "Анне" --from "От мамы"
//   node tools/certificate.mjs --lang pl --lessons 5 --format offline --to "Ивану"
//
// Параметры: --lang en|pl (по умолчанию en), --lessons 5|10|20|любое число,
// --format online|offline (по умолчанию online), --to «кому» и --from «от кого» (необязательно),
// --months срок в месяцах (по умолчанию 12).
// Файлы появляются в папке certificates/ (её нет в git: там имена людей).
// Каждый сертификат записывается в certificates/реестр.csv: по номеру видно, кому, когда и сколько уроков.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SITE_URL } from './site.config.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1] ?? '';

const lang = args.lang === 'pl' ? 'pl' : 'en';
const n = Number(args.lessons || 10);
const format = args.format === 'offline' ? 'offline' : 'online';
const months = Number(args.months || 12);
if (!Number.isInteger(n) || n < 1 || n > 200) fail('количество уроков: --lessons 10');
if (!Number.isInteger(months) || months < 1 || months > 36) fail('срок в месяцах: --months 12');

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const outDir = here('../certificates/');
const registry = join(outDir, 'реестр.csv');
mkdirSync(outDir, { recursive: true });
if (!existsSync(registry)) writeFileSync(registry, '\uFEFFНомер;Выдан;Действует до;Язык;Уроков;Формат;Кому;От кого\n');

// номер: следующий по реестру, 0001, 0002...
const rows = readFileSync(registry, 'utf8').trim().split('\n').length - 1;
const no = String(rows + 1).padStart(4, '0');
const today = new Date();
const until = new Date(today);
until.setMonth(until.getMonth() + months);
const date = (d) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

const plural = (k) => {
  const d = k % 10, h = k % 100;
  return k + (d === 1 && h !== 11 ? ' урок' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? ' урока' : ' уроков');
};
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).slice(0, 60);

// шрифты сайта встраиваем прямо в страницу (так их видно и в PDF)
const font = (family, style, weight, file) =>
  `@font-face { font-family: "${family}"; font-style: ${style}; font-weight: ${weight}; src: url(data:font/woff2;base64,${readFileSync(here('../site/assets/fonts/' + file)).toString('base64')}) format("woff2"); }`;
const fonts = [
  font('Manrope', 'normal', '400 800', 'manrope-cyrillic.woff2'),
  font('Manrope', 'normal', '400 800', 'manrope-latin.woff2'),
  font('Cormorant Garamond', 'italic', 600, 'cormorant-italic-cyrillic.woff2'),
  font('Cormorant Garamond', 'italic', 600, 'cormorant-italic-latin.woff2'),
  font('IBM Plex Mono', 'normal', 500, 'plex-mono-500-cyrillic.woff2'),
  font('IBM Plex Mono', 'normal', 500, 'plex-mono-500-latin.woff2'),
].join('\n');

const to = [args.to && `<div><p class="mono">Кому</p><p>${esc(args.to)}</p></div>`, args.from && `<div><p class="mono">От кого</p><p>${esc(args.from)}</p></div>`]
  .filter(Boolean).join('');
const values = {
  fonts, lang, no, to,
  word: lang === 'pl' ? 'polski' : 'english',
  lessons: plural(n),
  subject: lang === 'pl' ? 'польского' : 'английского',
  format: format === 'offline' ? 'лично в Санкт-Петербурге' : 'онлайн',
  until: date(until),
  site: (SITE_URL || 'elienglish.ru').replace(/^https?:\/\//, '') + (lang === 'pl' ? '/pl' : ''),
};
const html = readFileSync(here('certificate.html'), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');

// ---------- печать через Edge без окна ----------
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9900 + Math.floor(Math.random() * 90);
const profile = join(tmpdir(), 'eli-cert-' + port);
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
if (!target) { proc.kill(); fail('Edge не запустился'); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1123, height: 794, deviceScaleFactor: 2, mobile: false });
const frame = (await send('Page.getFrameTree')).result.frameTree.frame.id;
await send('Page.setDocumentContent', { frameId: frame, html });
await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
await sleep(300);

const base = join(outDir, `сертификат-${no}`);
const jpg = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
writeFileSync(base + '.jpg', Buffer.from(jpg.result.data, 'base64'));
const pdf = await send('Page.printToPDF', { landscape: false, printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
writeFileSync(base + '.pdf', Buffer.from(pdf.result.data, 'base64'));

ws.close();
proc.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}

const csv = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
appendFileSync(registry, [no, date(today), date(until), lang === 'pl' ? 'польский' : 'английский', n, format === 'offline' ? 'лично' : 'онлайн', csv(args.to), csv(args.from)].join(';') + '\n');

console.log(`Сертификат № ${no}: ${plural(n)} ${values.subject}, ${values.format}, до ${values.until}`);
console.log('  для печати:      ' + base + '.pdf');
console.log('  для мессенджера: ' + base + '.jpg');
console.log('  записан в реестр: ' + registry);
process.exit(0);

function fail(message) {
  console.error('Ошибка: ' + message);
  process.exit(1);
}

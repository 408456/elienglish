// Убирает однотонный светлый фон у фото (студийный белый) и сохраняет лёгкие webp с прозрачностью:
//   node tools/cutout.mjs <фото> <site/assets/img/имя> <ширина> [ширина ...]
//   например: node tools/cutout.mjs new.webp site/assets/img/teacher-en-v2 680 1030
// Получится teacher-en-v2-680.webp и teacher-en-v2-1030.webp. Нужен ffmpeg.
// Фон убирается только там, где он связан с краем кадра, поэтому светлые места на одежде и лице не трогаются.
import { spawnSync } from 'node:child_process';

const [input, outPrefix, ...widths] = process.argv.slice(2);
if (!input || !outPrefix || !widths.length) {
  console.error('Пример: node tools/cutout.mjs new.webp site/assets/img/teacher-en-v2 680 1030');
  process.exit(1);
}

function ffmpeg(args, stdin) {
  const r = spawnSync('ffmpeg', ['-v', 'error', ...args], { input: stdin, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr.toString());
  return r.stdout;
}

const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', input]);
const [W, H] = probe.stdout.toString().trim().split(',').map(Number);
const rgb = ffmpeg(['-i', input, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);

// цвет фона: медиана пикселей по краю кадра
const edge = [];
for (let x = 0; x < W; x += 4) edge.push(x, (H - 1) * W + x, x + 0);
for (let y = 0; y < H; y += 4) edge.push(y * W, y * W + W - 1);
const channel = (c) => edge.map((p) => rgb[p * 3 + c]).sort((a, b) => a - b)[edge.length >> 1];
const bg = [channel(0), channel(1), channel(2)];
const dist = (p) => Math.max(Math.abs(rgb[p * 3] - bg[0]), Math.abs(rgb[p * 3 + 1] - bg[1]), Math.abs(rgb[p * 3 + 2] - bg[2]));

// заливка от краёв: всё, что похоже на фон и связано с краем, считается фоном
const LO = 16;  // настолько близко к фону (с лёгкими тенями студии): полностью прозрачно
const HI = 52;  // дальше этого: уже человек, полностью непрозрачно
const isBg = new Uint8Array(W * H);
const queue = new Int32Array(W * H);
let head = 0;
let tail = 0;
const push = (p) => { if (!isBg[p] && dist(p) <= HI) { isBg[p] = 1; queue[tail++] = p; } };
for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
while (head < tail) {
  const p = queue[head++];
  const x = p % W;
  if (x > 0) push(p - 1);
  if (x < W - 1) push(p + 1);
  if (p >= W) push(p - W);
  if (p < W * (H - 1)) push(p + W);
}

// прозрачность с мягким краем и без белой каймы на волосах
const rgba = Buffer.alloc(W * H * 4);
for (let p = 0; p < W * H; p++) {
  let a = 1;
  if (isBg[p]) a = Math.min(1, Math.max(0, (dist(p) - LO) / (HI - LO)));
  for (let c = 0; c < 3; c++) {
    const v = rgb[p * 3 + c];
    // убираем белую примесь только на краю волос (a от 0.5): на почти прозрачных точках это даёт серую дымку
    // полностью прозрачные точки делаем белыми: сжатие webp не даст им проступить на белом сайте
    rgba[p * 4 + c] = a === 0 ? 255 : a >= 0.5 && a < 1 ? Math.max(0, Math.min(255, Math.round(bg[c] + (v - bg[c]) / a))) : v;
  }
  rgba[p * 4 + 3] = Math.round(a * 255);
}

for (const w of widths.map(Number)) {
  const out = `${outPrefix}-${w}.webp`;
  ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-',
    '-vf', `scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', '-pix_fmt', 'yuva420p', '-y', out], rgba);
  console.log('сохранено:', out);
}
console.log(`фон ${bg.join(',')}, исходник ${W}×${H}`);

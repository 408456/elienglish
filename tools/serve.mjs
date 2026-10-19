// Локальный просмотр сайта: отдаёт папку site/.
// Работает только на этом компьютере (127.0.0.1) и повторяет правила
// безопасности из site/.htaccess: те же заголовки и те же закрытые файлы.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../site/', import.meta.url));
const port = Number(process.env.PORT) || 5175;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.woff2': 'font/woff2',
};

// Заголовки и запреты читаем из .htaccess, чтобы локально было как на хостинге.
const htaccess = readFileSync(join(root, '.htaccess'), 'utf8');
const securityHeaders = {};
for (const [, name, value] of htaccess.matchAll(/^\s*Header always set (\S+) "([^"]*)"/gm)) {
  if (name === 'Strict-Transport-Security') continue; // только для HTTPS
  securityHeaders[name] = name === 'Content-Security-Policy'
    ? value.replace(/;\s*upgrade-insecure-requests/, '') // локально сайт открыт по http
    : value;
}
const deniedFiles = [...htaccess.matchAll(/<FilesMatch "([^"]+)">\s*Require all denied/g)].map((m) => new RegExp(m[1]));

function send(res, status, headers, body) {
  res.writeHead(status, { ...securityHeaders, ...headers });
  res.end(body);
}

createServer(async (req, res) => {
  let url;
  let path;
  try {
    url = new URL(req.url, 'http://localhost');
    path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  } catch {
    send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Неверный адрес');
    return;
  }

  if (path === '' || path.endsWith('/') || path.endsWith('\\')) path += 'index.html';
  const file = join(root, path);
  if (!file.startsWith(root) || path.split(/[/\\]/).some((part) => deniedFiles.some((re) => re.test(part))) || deniedFiles.some((re) => re.test(basename(file)))) {
    send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Доступ запрещён');
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      // /pl -> /pl/, как на хостинге
      send(res, 301, { Location: url.pathname + '/' + url.search }, '');
      return;
    }
    const data = await readFile(file);
    send(res, 200, {
      'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }, data);
  } catch {
    try {
      send(res, 404, { 'Content-Type': types['.html'] }, await readFile(join(root, '404.html')));
    } catch {
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Не найдено');
    }
  }
}).listen(port, '127.0.0.1', () => console.log(`elienglish: http://localhost:${port}`));

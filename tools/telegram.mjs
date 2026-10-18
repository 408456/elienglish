// Подключение бота заявок к Google Apps Script:
//   node tools/telegram.mjs connect <адрес веб-приложения>   бот + сайт начинают работать через Google
//   node tools/telegram.mjs info                             что сейчас подключено
//   node tools/telegram.mjs owner                            одноразовая ссылка владельца
//   node tools/telegram.mjs test                             отправить тестовую заявку как с сайта
//   node tools/telegram.mjs disconnect                       отключить бота от Google
// Секреты лежат в google/secrets.local.json (не в git).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Антивирусы подменяют сертификаты HTTPS: доверяем сертификатам Windows.
if (!process.execArgv.includes('--use-system-ca')) {
  const r = spawnSync(process.execPath, ['--use-system-ca', ...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const secretsFile = root + 'google/secrets.local.json';
const secrets = JSON.parse(readFileSync(secretsFile, 'utf8'));
const [cmd = 'info', arg = ''] = process.argv.slice(2);

async function tg(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${secrets.token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}

const me = await tg('getMe');

if (cmd === 'connect') {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(arg)) {
    console.error('Нужен адрес вида https://script.google.com/macros/s/.../exec');
    process.exit(1);
  }
  await tg('setWebhook', {
    url: `${arg}?s=${secrets.webhookSecret}`,
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    max_connections: 1, // по одному событию за раз: так не бывает гонок в таблице
    drop_pending_updates: true,
  });
  secrets.appsScriptUrl = arg;
  writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));
  // адрес приёма заявок в сайт
  const mainJs = root + 'site/assets/js/main.js';
  const js = readFileSync(mainJs, 'utf8').replace(/var LEADS_URL = '[^']*';/, `var LEADS_URL = '${arg}';`);
  writeFileSync(mainJs, js);
  spawnSync(process.execPath, [root + 'tools/build.mjs'], { stdio: 'ignore' });
  console.log(`Готово: бот @${me.username} работает через Google, форма сайта отправляет заявки туда же.`);
  console.log(`Стать владельцем (одноразово): https://t.me/${me.username}?start=own_${secrets.ownerCode}`);
} else if (cmd === 'info') {
  const hook = await tg('getWebhookInfo');
  console.log(`Бот: @${me.username}`);
  console.log(`Приём: ${hook.url ? hook.url.replace(/\?s=.*/, '?s=***') : 'не подключён'}`);
  console.log(`Ждут обработки: ${hook.pending_update_count}`);
  if (hook.last_error_message) console.log(`Последняя ошибка: ${hook.last_error_message} (${new Date(hook.last_error_date * 1000).toLocaleString('ru-RU')})`);
} else if (cmd === 'owner') {
  console.log(`https://t.me/${me.username}?start=own_${secrets.ownerCode}`);
} else if (cmd === 'test') {
  if (!secrets.appsScriptUrl) throw new Error('Сначала: node tools/telegram.mjs connect <адрес>');
  const res = await fetch(secrets.appsScriptUrl, {
    method: 'POST',
    body: JSON.stringify({ kind: 'lead', name: 'Тест', phone: '+7 900 000-00-00', telegram: '', promo: '', ref: '', lang: 'en', elapsed: 9000, website: '' }),
  });
  console.log('Ответ Google:', await res.text());
} else if (cmd === 'disconnect') {
  await tg('deleteWebhook');
  console.log('Бот отключён от Google.');
} else {
  console.error('Команды: connect <адрес>, info, owner, test, disconnect');
  process.exit(1);
}

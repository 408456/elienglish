// Собирает google/bot.local.gs: тот же код, что google/bot.gs, но с токеном и секретами
// из google/secrets.local.json. Этот файл вставляют в Apps Script. В git он не попадает.
//   node tools/bot-local.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const secrets = JSON.parse(readFileSync(root + 'google/secrets.local.json', 'utf8'));
let code = readFileSync(root + 'google/bot.gs', 'utf8');

const set = (key, value) => {
  const re = new RegExp(`(  ${key}: )''`);
  if (!re.test(code)) throw new Error('нет ' + key + " в CONFIG (должно быть пустое значение '')");
  code = code.replace(re, `$1'${value}'`);
};
set('TOKEN', secrets.token);
set('WEBHOOK_SECRET', secrets.webhookSecret);
set('OWNER_CODE', secrets.ownerCode);

writeFileSync(root + 'google/bot.local.gs',
  '// ГОТОВО К ВСТАВКЕ в Google Apps Script. Здесь токен бота: этот файл никому не отправляйте и не кладите в git.\n' + code);
console.log('Готово: google/bot.local.gs (скопируйте его целиком в Apps Script)');

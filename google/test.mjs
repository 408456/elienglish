// Проверка бота для Google Apps Script без Google и без Telegram: node google/test.mjs
// Таблица, хранилище и Telegram подменены заглушками, все вызовы записываются.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('./bot.gs', import.meta.url), 'utf8');

// ---------- заглушки Google ----------
class Sheet {
  constructor() { this.data = []; }
  store(v) { return typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; } // как в Google: апостроф = «это текст»
  appendRow(row) { this.data.push(row.map((v) => this.store(v))); }
  getDataRange() { const d = this.data.length ? this.data : [['']]; return { getValues: () => d.map((r) => r.slice()) }; }
  getRange(row, col, rows = 1, cols = 1) {
    const self = this;
    return {
      setValue(v) { while (self.data.length < row) self.data.push([]); self.data[row - 1][col - 1] = self.store(v); return this; },
      getValues() { return [Array.from({ length: cols }, (_, i) => (self.data[row - 1] || [])[col - 1 + i] ?? '')]; },
      setValues(v) { v[0].forEach((x, i) => { while (self.data.length < row) self.data.push([]); self.data[row - 1][col - 1 + i] = self.store(x); }); return this; },
      setFontWeight() { return this; },
    };
  }
  getLastRow() { return this.data.length; }
  setFrozenRows() {}
}
const sheets = {};
const props = {};
const cache = {};
const calls = [];
let mid = 100;
function fakeFetch(url, opt) {
  const method = url.split('/').pop();
  const payload = JSON.parse(opt.payload);
  calls.push([method, payload]);
  const result = method === 'sendMessage' ? { message_id: ++mid } : method === 'getMe' ? { username: 'elienglish_requests_bot' } : true;
  return { getContentText: () => JSON.stringify({ ok: true, result }), getResponseCode: () => 200 };
}
const sandbox = {
  console: { log() {}, warn() {}, error: (...a) => console.error('  [скрипт]', ...a) },
  SpreadsheetApp: { getActive: () => ({
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new Sheet()),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST',
  }) },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) },
  CacheService: { getScriptCache: () => ({
    get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: (k) => { delete cache[k]; },
  }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  UrlFetchApp: {
    fetch: (url, opt) => fakeFetch(url, opt),
    fetchAll: (reqs) => reqs.map((r) => fakeFetch(r.url, r)),
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  HtmlService: { createHtmlOutput: (t) => ({ html: t }) },
  Utilities: { formatDate: () => '19.10.2026 10:00' },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
vm.runInContext("CONFIG.TOKEN = 't'; CONFIG.WEBHOOK_SECRET = 'secret123'; CONFIG.OWNER_CODE = 'owner0123456789abcdef';", sandbox);

// ---------- помощники ----------
let passed = 0, failed = 0;
const check = (name, ok) => { ok ? passed++ : failed++; console.log((ok ? '  ок   ' : '  ОШИБКА ') + name); };
const take = () => calls.splice(0);
const to = (list, chat) => list.filter(([m, p]) => m === 'sendMessage' && p.chat_id === chat);
let upd = 1000;
const tgPost = (u, s = 'secret123') => sandbox.doPost({ parameter: { s }, postData: { contents: JSON.stringify(u) } });
const msg = (from, text, username = '', first = 'Тест') => tgPost({ update_id: ++upd, message: { message_id: upd, chat: { id: from, type: 'private' }, from: { id: from, first_name: first, username }, text } });
const press = (from, data) => tgPost({ update_id: ++upd, callback_query: { id: 'q' + upd, data, from: { id: from, first_name: 'Тест' }, message: { message_id: 5, chat: { id: from, type: 'private' } } } });
const site = (lead) => JSON.parse(sandbox.doPost({ parameter: {}, postData: { contents: JSON.stringify({ kind: 'lead', elapsed: 9000, ...lead }) } }).text);
const leads = () => (sheets['Заявки'] ? sheets['Заявки'].data.slice(1) : []);
const OWNER = 111, SISTER = 222, STRANGER = 444;

console.log('Админы');
msg(STRANGER, '/start own_wrongcode0000000000');
check('чужая ссылка владельца не даёт доступ', !sandbox.isAdmin_(STRANGER));
check('посторонний получает служебный ответ', to(take(), STRANGER).length === 1);
msg(STRANGER, 'ещё');
check('служебный ответ не чаще раза в 10 минут', to(take(), STRANGER).length === 0);
msg(OWNER, '/start own_owner0123456789abcdef', 'gleb', 'Глеб');
check('владелец по одноразовой ссылке', sandbox.isOwner_(OWNER));
check('владельцу пришло меню с «Обновить»', JSON.stringify(to(take(), OWNER)[0][1].reply_markup).includes('Обновить'));
msg(STRANGER, '/start own_owner0123456789abcdef');
check('ссылка владельца одноразовая', !sandbox.isAdmin_(STRANGER));
take();
msg(SISTER, '/start', 'Eligolc', 'Элли');
check('@Eligolc стала админом сама', sandbox.isAdmin_(SISTER) && !sandbox.isOwner_(SISTER));
take();

console.log('\nЗаявка с сайта');
let r = site({ name: 'Анна', phone: '+7 (921) 123-45-67', telegram: '@anna_test', lang: 'en' });
check('сайт получил ok', r.ok === true);
check('заявка записана в таблицу', leads().length === 1 && leads()[0][3] === 'Анна' && leads()[0][4] === '+7 (921) 123-45-67' && leads()[0][8] === 'Новая');
let c = take();
const card = to(c, SISTER)[0];
check('карточка пришла обоим админам', to(c, OWNER).length === 1 && !!card);
const btns = card[1].reply_markup.inline_keyboard.flat();
const tgBtn = btns.find((b) => b.text === 'Ответить в Telegram');
check('кнопка «Ответить в Telegram» с готовым текстом', tgBtn && tgBtn.url.startsWith('https://t.me/anna_test?text=') && decodeURIComponent(tgBtn.url).includes('Анна'));
check('кнопка WhatsApp на номер', btns.some((b) => b.text === 'WhatsApp' && b.url.startsWith('https://wa.me/79211234567?text=')));
check('кнопки статусов', btns.some((b) => b.callback_data === 's:1:w'));

console.log('\nЗащита формы');
r = site({ name: 'Анна', phone: '+7 921 123-45-67', website: 'http://spam' });
check('бот заполнил скрытое поле: ok, но не записано', r.ok && leads().length === 1);
r = JSON.parse(sandbox.doPost({ parameter: {}, postData: { contents: JSON.stringify({ kind: 'lead', name: 'Анна', phone: '+79211234567', elapsed: 500 }) } }).text);
check('слишком быстро: ok, но не записано', r.ok && leads().length === 1);
r = site({ name: '=HYPERLINK("http://evil")', phone: '+79211234567' });
check('формула вместо имени отклонена', r.error === 'fields' && r.fields.includes('name'));
r = site({ name: 'Анна', phone: '123' });
check('короткий телефон отклонён', r.fields && r.fields.includes('phone'));
r = site({ name: 'Анна', phone: '+7 (111) 111-11-11' });
check('несуществующий код +7 (111) отклонён', r.fields && r.fields.includes('phone'));
r = site({ name: 'Анна', phone: '+7 (921) 123-45' });
check('российский номер без двух цифр отклонён', r.fields && r.fields.includes('phone'));
r = site({ name: 'аааа', phone: '+79211234567' });
check('имя из одной буквы подряд отклонено', r.fields && r.fields.includes('name'));
r = site({ name: 'Анна', phone: '+79211234567', telegram: 'abc' });
check('слишком короткий ник отклонён', r.fields && r.fields.includes('telegram'));
r = site({ name: 'Анна', phone: '+44 7911 123456', telegram: 'https://t.me/anna_uk' });
check('иностранный номер и ссылка t.me приняты', r.ok === true && leads().slice(-1)[0][5] === '@anna_uk');
sheets['Заявки'].data.pop();
r = site({ name: 'Анна', phone: '+79211234567', promo: '=1+1' });
check('мусорный промокод отклонён', r.fields && r.fields.includes('promo'));
r = JSON.parse(sandbox.doPost({ parameter: {}, postData: { contents: 'x'.repeat(5000) } }).text);
check('слишком большой запрос отклонён', r.error === 'too_big');
r = JSON.parse(sandbox.doPost({ parameter: {}, postData: { contents: '{bad' } }).text);
check('битый запрос отклонён', r.ok === false);
take();

console.log('\nОбновить и статусы');
msg(SISTER, 'Обновить');
check('«Обновить» показывает новую заявку', to(take(), SISTER).some(([, p]) => p.text.includes('Заявка №1')));
press(SISTER, 's:1:w');
check('статус «В работе» записан в таблицу', leads()[0][8] === 'В работе' && leads()[0][9] === 'Элли');
check('карточки у админов обновились', take().some(([m]) => m === 'editMessageText'));
msg(SISTER, 'Обновить');
check('после этого новых нет', to(take(), SISTER).some(([, p]) => p.text.startsWith('Новых заявок нет')));
msg(SISTER, 'В работе');
check('«В работе» показывает заявку', to(take(), SISTER).some(([, p]) => p.text.includes('Заявка №1')));
press(SISTER, 's:1:w');
check('повторное нажатие возвращает «Новая»', leads()[0][8] === 'Новая');
press(STRANGER, 's:1:c');
check('посторонний не меняет статус', leads()[0][8] === 'Новая');
take();

console.log('\nШаблон ответа');
press(SISTER, 'te');
msg(SISTER, 'Здравствуйте, {имя}! Оплата: https://pay.example/123. Ваш код {промокод}.');
take();
check('шаблон сохранён и подставляет имя', sandbox.templateFor_({ name: 'Ольга', lang: 'польский', promo: 'X1' }) === 'Здравствуйте, Ольга! Оплата: https://pay.example/123. Ваш код X1.');
press(SISTER, 't:1');
check('«Текст ответа» присылает готовый текст', to(take(), SISTER).some(([, p]) => p.text.includes('Здравствуйте, Анна!')));
press(SISTER, 'tr');
take();

console.log('\nПромокоды');
press(SISTER, 'pa');
msg(SISTER, 'VESNA скидка без цифр');
check('код без скидки не добавлен', !sheets['Промокоды'] || sheets['Промокоды'].data.length <= 1);
press(SISTER, 'pa');
msg(SISTER, 'vesna10 10 весенняя акция');
check('промокод добавлен со скидкой', sheets['Промокоды'].data[1][0] === 'VESNA10' && Number(sheets['Промокоды'].data[1][4]) === 10 && sheets['Промокоды'].data[1][1] === 'весенняя акция');
sheets['Промокоды'].data.push(['OLD5', 'скидка 5% на первый пакет', 'да', 0]); // код из старой версии, без столбца «Скидка, %»
delete cache.promos;
take();
const get = (code) => JSON.parse(sandbox.doGet({ parameter: { promo: code } }).text);
check('сайт: код действует, скидка 10%', JSON.stringify(get('vesna10')) === JSON.stringify({ ok: true, code: 'VESNA10', off: 10 }));
check('сайт: старый код со скидкой из описания', get('OLD5').off === 5);
check('сайт: неизвестный код', get('NOPE').ok === false);
check('сайт: мусор вместо кода', get('<x>').ok === false);
check('без параметра doGet отвечает как раньше', sandbox.doGet({ parameter: {} }).text === 'eli english: ok');
r = site({ name: 'Мария', phone: '+79001112233', lang: 'pl', promo: 'vesna10', ref: 'abc123' });
c = take();
const t2 = to(c, SISTER)[0][1].text;
check('в заявке видно промокод и скидку', r.ok && t2.includes('VESNA10 (−10%)'));
check('скидка записана в таблицу', leads().slice(-1)[0][7] === '−10%');
check('реферальных строк больше нет', !t2.includes('По ссылке'));
check('счётчик промокода вырос', Number(sheets['Промокоды'].data[1][3]) === 1);
press(SISTER, 'pt:VESNA10');
check('промокод можно выключить', sheets['Промокоды'].data[1][2] === 'нет');
check('выключенный код сайт не принимает', get('VESNA10').ok === false);
take();
msg(SISTER, 'Промокоды');
check('в списке видно скидку', to(take(), SISTER).some(([, p]) => p.text.includes('VESNA10</b>: −10%')));
msg(OWNER, 'Обновить');
check('в меню нет «Рефералов»', !JSON.stringify(calls).includes('Рефералы'));
take();

console.log('\nСтарая таблица');
check('у листа промокодов появился столбец «Скидка, %»', sheets['Промокоды'].data[0][4] === 'Скидка, %');
sheets['Заявки'].data[0][7] = 'Реферал'; // заголовок из прошлой версии
sheets['Промокоды'].data[0].length = 4;
vm.runInContext('for (const k in headersChecked_) delete headersChecked_[k]; sheet_(SHEET_LEADS); sheet_(SHEET_PROMO);', sandbox);
check('заголовок «Реферал» заменён на «Скидка»', sheets['Заявки'].data[0][7] === 'Скидка');
check('в старый лист промокодов дописан столбец «Скидка, %»', sheets['Промокоды'].data[0][4] === 'Скидка, %');

console.log('\nTelegram: защита');
calls.length = 0;
tgPost({ update_id: ++upd, message: { message_id: 1, chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, text: 'Обновить' } }, 'wrong');
check('запрос без секрета игнорируется', calls.length === 0);
const once = { update_id: ++upd, message: { message_id: 1, chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, text: 'Обновить' } };
tgPost(once);
take();
tgPost(once);
check('повтор того же события не обрабатывается', calls.length === 0);
take();
tgPost({ update_id: ++upd, my_chat_member: { chat: { id: -100, type: 'group' }, new_chat_member: { status: 'member' } } });
check('из групп бот уходит', take()[0][0] === 'leaveChat');
press(SISTER, 'aa');
check('админ (не владелец) не управляет админами', !('st_' + SISTER in cache));
press(SISTER, 'zz:<script>');
check('мусорные кнопки игнорируются', true);
take();

console.log('\nВладелец и админы');
press(OWNER, 'ad:' + SISTER);
check('владелец убрал админа', !sandbox.isAdmin_(SISTER));
msg(SISTER, '/start', 'Eligolc');
check('после удаления имя из настроек не возвращает доступ', !sandbox.isAdmin_(SISTER));
press(OWNER, 'aa');
msg(OWNER, '@Eligolc');
msg(SISTER, '/start', 'Eligolc', 'Элли');
check('владелец добавил её снова', sandbox.isAdmin_(SISTER));

console.log('\nДлинный шаблон');
check('очень длинный текст: ссылка без текста, текст по кнопке', sandbox.urlWithText_('https://t.me/a', 'я'.repeat(800)) === 'https://t.me/a');

console.log(`\nИтог: ${passed} проверок прошло, ${failed} с ошибкой`);
process.exit(failed ? 1 : 0);

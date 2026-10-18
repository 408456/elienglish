/**
 * eli english: бот заявок @elienglish_requests_bot на Google Apps Script.
 *
 * Как устроено:
 * - сайт отправляет заявку из формы сюда, она записывается в эту Google Таблицу (лист «Заявки»)
 *   и сразу приходит админам в Telegram карточкой с кнопками;
 * - админ в боте нажимает «Обновить» и видит все новые заявки;
 * - «Ответить в Telegram» / «WhatsApp» открывают чат с человеком, где уже вписан шаблон ответа:
 *   остаётся нажать «Отправить» со своего аккаунта;
 * - статусы «В работе», «Записан», «Закрыта» пишутся в таблицу и видны всем админам;
 * - промокоды и реферальные ссылки создаются в боте и лежат на листах «Промокоды» и «Рефералы».
 *
 * Скрипт привязан к таблице: Расширения → Apps Script. Публикация: Начать развёртывание →
 * Веб-приложение, выполнять от моего имени, доступ: все.
 */

// ---------------------------------------------------------------- настройки

const CONFIG = {
  TOKEN: '',                 // токен бота от @BotFather
  WEBHOOK_SECRET: '',        // длинная случайная строка: Telegram присылает её в адресе
  OWNER_CODE: '',            // одноразовый код владельца бота
  ADMIN_USERNAMES: ['eligolc'], // станут админами, когда откроют бота (без @, маленькими буквами)
  SITE_URL: 'https://408456.github.io/elienglish/', // для реферальных ссылок
  PERSONAL_TG: 'Eligolc',    // личный Telegram преподавателя
  TIMEZONE: 'Europe/Moscow',
};

const STATUSES = { n: 'Новая', w: 'В работе', b: 'Записан', c: 'Закрыта' };
const DEFAULT_TEMPLATE =
  'Здравствуйте, {имя}! Это eli english. Спасибо за заявку на бесплатный пробный урок {языка}.\n\n' +
  'Подскажите, в какие дни и в какое время вам удобно? Пробный урок длится 30 минут.\n\n' +
  'Оплата: пакетами уроков после пробного урока. Цены: ' + CONFIG.SITE_URL + '#ceny';

const SHEET_LEADS = 'Заявки';
const SHEET_PROMO = 'Промокоды';
const SHEET_REFS = 'Рефералы';
const LEAD_HEADERS = ['№', 'Дата', 'Язык', 'Имя', 'Телефон', 'Telegram', 'Промокод', 'Реферал', 'Статус', 'Изменил', 'Когда', 'Сообщения бота'];
// буквы латиницы (с польскими и европейскими) и кириллицы
const LETTERS = 'A-Za-zÀ-ÖØ-öø-ɏЀ-ӿ';
const NAME_RE = new RegExp('^[' + LETTERS + '][' + LETTERS + " .'-]*$");
const HEADERS = {
  [SHEET_LEADS]: LEAD_HEADERS,
  [SHEET_PROMO]: ['Код', 'Описание', 'Активен', 'Заявок'],
  [SHEET_REFS]: ['Код', 'Кому', 'Ссылка', 'Заявок', 'Создан'],
};
const COL = { id: 0, date: 1, lang: 2, name: 3, phone: 4, tg: 5, promo: 6, ref: 7, status: 8, by: 9, at: 10, msgs: 11 };

// ---------------------------------------------------------------- вход

function doGet() {
  return ContentService.createTextOutput('eli english: ok');
}

function doPost(e) {
  const params = (e && e.parameter) || {};
  const raw = (e && e.postData && e.postData.contents) || '';
  if (params.s !== undefined) {
    return telegramEntry_(String(params.s), raw);
  }
  return siteEntry_(raw);
}

// ---------------------------------------------------------------- заявка с сайта

function siteEntry_(raw) {
  if (raw.length > 4096) return json_({ ok: false, error: 'too_big' });
  let d;
  try { d = JSON.parse(raw); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  if (!d || typeof d !== 'object' || d.kind !== 'lead') return json_({ ok: false, error: 'bad_request' });

  // ловушки для ботов: делаем вид, что всё хорошо, но ничего не сохраняем
  if (d.website) return json_({ ok: true });
  if (typeof d.elapsed !== 'number' || d.elapsed < 3000) return json_({ ok: true });

  // не больше 40 заявок за 10 минут со всего сайта
  const cache = CacheService.getScriptCache();
  const bucket = 'site_' + Math.floor(Date.now() / 600000);
  const count = Number(cache.get(bucket) || 0);
  if (count >= 40) return json_({ ok: false, error: 'too_many' });
  cache.put(bucket, String(count + 1), 700);

  const lead = {
    name: cleanText_(d.name, 60),
    phone: cleanText_(d.phone, 25),
    tg: String(d.telegram || '').trim().replace(/^@/, ''),
    lang: d.lang === 'pl' ? 'pl' : 'en',
    promo: String(d.promo || '').trim().toUpperCase(),
    ref: String(d.ref || '').trim().toLowerCase(),
  };
  const errors = [];
  if (lead.name.length < 2 || !NAME_RE.test(lead.name)) errors.push('name');
  const digits = lead.phone.replace(/\D/g, '');
  if (!/^\+?[\d\s()-]{10,25}$/.test(lead.phone) || digits.length < 10 || digits.length > 15) errors.push('phone');
  if (lead.tg && !/^[A-Za-z0-9_]{4,32}$/.test(lead.tg)) errors.push('telegram');
  if (lead.promo && !/^[A-Z0-9_-]{2,20}$/.test(lead.promo)) errors.push('promo');
  if (lead.ref && !/^[a-z0-9]{4,12}$/.test(lead.ref)) lead.ref = '';
  if (errors.length) return json_({ ok: false, error: 'fields', fields: errors });

  withLock_(function () {
    const id = saveLead_(lead);
    notifyNewLead_(id);
  });
  return json_({ ok: true });
}

function saveLead_(lead) {
  const sheet = sheet_(SHEET_LEADS);
  const props = PropertiesService.getScriptProperties();
  const id = Number(props.getProperty('next_id') || 1);
  props.setProperty('next_id', String(id + 1));
  if (lead.promo) bumpCounter_(SHEET_PROMO, lead.promo, 3);
  if (lead.ref) bumpCounter_(SHEET_REFS, lead.ref, 3);
  sheet.appendRow([id, now_(), lead.lang === 'pl' ? 'польский' : 'английский', lead.name, lead.phone, lead.tg ? '@' + lead.tg : '',
    lead.promo, lead.ref, STATUSES.n, '', '', ''].map(safe_));
  return id;
}

// ---------------------------------------------------------------- Telegram

function telegramEntry_(secret, raw) {
  const ok = HtmlService.createHtmlOutput('ok'); // 200 без перенаправления, чтобы Telegram не слал повторно
  if (!CONFIG.WEBHOOK_SECRET || secret !== CONFIG.WEBHOOK_SECRET) return ok;
  if (raw.length > 1000000) return ok;
  let u;
  try { u = JSON.parse(raw); } catch (err) { return ok; }
  if (!u || typeof u.update_id !== 'number') return ok;

  withLock_(function () {
    const props = PropertiesService.getScriptProperties();
    const last = Number(props.getProperty('last_update') || 0);
    if (u.update_id <= last) return; // уже обработано
    props.setProperty('last_update', String(u.update_id));
    try {
      if (u.message) onMessage_(u.message);
      else if (u.callback_query) onCallback_(u.callback_query);
      else if (u.my_chat_member) onMember_(u.my_chat_member);
    } catch (err) {
      console.error('update ' + u.update_id + ': ' + err);
    }
  });
  return ok;
}

function tg_(method, payload) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + CONFIG.TOKEN + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  let j = null;
  try { j = JSON.parse(res.getContentText()); } catch (err) { /* нет ответа */ }
  if (!j || !j.ok) {
    const desc = j && j.description ? j.description : 'нет ответа';
    if (desc.indexOf('message is not modified') === -1) console.warn(method + ': ' + desc);
    return null;
  }
  return j.result;
}

function send_(chat, text, markup) {
  const p = { chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (markup) p.reply_markup = markup;
  const r = tg_('sendMessage', p);
  return r ? r.message_id : null;
}

function edit_(chat, messageId, text, markup) {
  const p = { chat_id: chat, message_id: messageId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (markup) p.reply_markup = markup;
  tg_('editMessageText', p);
}

function answer_(id, text) {
  tg_('answerCallbackQuery', { callback_query_id: id, text: text || '' });
}

// ---------------------------------------------------------------- админы

function admins_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('admins') || '{}');
}

function saveAdmins_(a) {
  PropertiesService.getScriptProperties().setProperty('admins', JSON.stringify(a));
}

function isAdmin_(id) { return Boolean(admins_()[id]); }
function isOwner_(id) { const a = admins_()[id]; return Boolean(a && a.role === 'owner'); }

function personName_(from) {
  return cleanText_([from.first_name, from.last_name].filter(Boolean).join(' '), 40) || 'без имени';
}

// Админ по имени пользователя: из настроек или добавленный владельцем.
// Имя закрепляется за первым вошедшим с ним человеком.
function maybePromote_(from) {
  const username = String(from.username || '').toLowerCase();
  if (!username || isAdmin_(from.id)) return;
  const props = PropertiesService.getScriptProperties();
  const pending = JSON.parse(props.getProperty('pending') || '[]');
  const bound = JSON.parse(props.getProperty('bound') || '{}');
  if (CONFIG.ADMIN_USERNAMES.indexOf(username) === -1 && pending.indexOf(username) === -1) return;
  if (bound[username] !== undefined && bound[username] !== from.id) return;
  bound[username] = from.id;
  props.setProperty('bound', JSON.stringify(bound));
  props.setProperty('pending', JSON.stringify(pending.filter(function (u) { return u !== username; })));
  const a = admins_();
  a[from.id] = { name: personName_(from), username: username, role: 'admin' };
  saveAdmins_(a);
  Object.keys(a).forEach(function (id) {
    if (Number(id) !== from.id) send_(Number(id), esc_(personName_(from)) + ' (@' + esc_(username) + ') теперь админ бота заявок.');
  });
}

function menu_(id) {
  const rows = [
    [{ text: 'Обновить' }, { text: 'В работе' }],
    [{ text: 'Все заявки' }, { text: 'Шаблон ответа' }],
    [{ text: 'Промокоды' }, { text: 'Рефералы' }],
    [{ text: 'Помощь' }],
  ];
  if (isOwner_(id)) rows[3].push({ text: 'Админы' });
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}

// ---------------------------------------------------------------- сообщения

function onMember_(m) {
  const chat = m.chat || {};
  const status = (m.new_chat_member || {}).status;
  if (chat.type !== 'private' && (status === 'member' || status === 'administrator')) {
    tg_('leaveChat', { chat_id: chat.id }); // бот работает только в личке
  }
}

function onMessage_(m) {
  const chat = m.chat || {};
  const from = m.from || {};
  if (chat.type !== 'private') { tg_('leaveChat', { chat_id: chat.id }); return; }
  if (from.is_bot || !from.id) return;
  const text = typeof m.text === 'string' ? m.text.trim() : '';

  const own = text.match(/^\/start own_([A-Za-z0-9]{16,64})$/);
  if (own) {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('owner_claimed') !== '1' && CONFIG.OWNER_CODE && own[1] === CONFIG.OWNER_CODE) {
      props.setProperty('owner_claimed', '1');
      const a = admins_();
      a[from.id] = { name: personName_(from), username: String(from.username || '').toLowerCase(), role: 'owner' };
      saveAdmins_(a);
      greet_(from.id);
      return;
    }
  }

  maybePromote_(from);
  if (!isAdmin_(from.id)) {
    // для всех остальных бот служебный: отвечаем не чаще раза в 10 минут
    const cache = CacheService.getScriptCache();
    const key = 'guest_' + from.id;
    if (!cache.get(key)) {
      cache.put(key, '1', 600);
      send_(from.id, 'Это служебный бот eli english для заявок.\n\nЗаписаться на бесплатный пробный урок можно на сайте ' +
        esc_(CONFIG.SITE_URL) + ' или написав преподавателю: @' + esc_(CONFIG.PERSONAL_TG));
    }
    return;
  }
  onAdminMessage_(from.id, text);
}

function greet_(id) {
  const a = admins_()[id];
  const open = leads_().filter(function (l) { return l.status === STATUSES.n; }).length;
  send_(id, 'Здравствуйте, ' + esc_(a.name) + '! Это кабинет заявок eli english' + (a.role === 'owner' ? ', вы владелец' : '') + '.\n\n' +
    '<b>Как пользоваться</b>\n' +
    '• Заявки с сайта приходят сюда сами. «Обновить» покажет все новые.\n' +
    '• «Ответить в Telegram» или «WhatsApp» откроют чат с человеком, где уже вписан шаблон ответа: проверьте и нажмите «Отправить».\n' +
    '• «В работе», «Записан», «Закрыта»: отметки для всех админов, они же пишутся в таблицу.\n' +
    '• «Шаблон ответа»: текст с вашими ссылками и условиями оплаты.\n' +
    '• «Промокоды» и «Рефералы»: коды для скидок и ссылки «приведи друга».\n\n' +
    'Все заявки лежат в таблице: ' + esc_(SpreadsheetApp.getActive().getUrl()) +
    (open ? '\n\nНовых заявок сейчас: ' + open + '. Нажмите «Обновить».' : ''), menu_(id));
}

function onAdminMessage_(id, text) {
  const cache = CacheService.getScriptCache();
  const state = cache.get('st_' + id);
  const menuWords = ['Обновить', 'В работе', 'Все заявки', 'Шаблон ответа', 'Промокоды', 'Рефералы', 'Помощь', 'Админы', '/start', '/help', '/cancel'];

  if (state && menuWords.indexOf(text) === -1) {
    cache.remove('st_' + id);
    if (state === 'te') return saveTemplate_(id, text);
    if (state === 'pa') return addPromo_(id, text);
    if (state === 'ra') return addRef_(id, text);
    if (state === 'aa' && isOwner_(id)) return addAdmin_(id, text);
  }
  cache.remove('st_' + id);

  switch (text) {
    case '/start': case 'Помощь': case '/help': return greet_(id);
    case 'Обновить': return showByStatus_(id, STATUSES.n, 'Новых заявок нет. Как только кто-то оставит заявку на сайте, она придёт сюда.');
    case 'В работе': return showByStatus_(id, STATUSES.w, 'Заявок в работе нет.');
    case 'Все заявки': return showAll_(id);
    case 'Шаблон ответа': return showTemplate_(id);
    case 'Промокоды': return showPromos_(id);
    case 'Рефералы': return showRefs_(id);
    case 'Админы': if (isOwner_(id)) return showAdmins_(id); break;
    case '/cancel': return send_(id, 'Отменено.', menu_(id));
  }
  send_(id, 'Выберите действие в меню внизу.', menu_(id));
}

// ---------------------------------------------------------------- заявки

function leads_() {
  const sheet = sheet_(SHEET_LEADS);
  const values = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (r[COL.id] === '' || r[COL.id] === null) continue;
    out.push({
      row: i + 1, id: Number(r[COL.id]), date: String(r[COL.date]), lang: String(r[COL.lang]),
      name: unsafe_(r[COL.name]), phone: unsafe_(r[COL.phone]), tg: unsafe_(r[COL.tg]).replace(/^@/, ''),
      promo: unsafe_(r[COL.promo]), ref: unsafe_(r[COL.ref]), status: String(r[COL.status] || STATUSES.n),
      by: String(r[COL.by] || ''), at: String(r[COL.at] || ''), msgs: parseJson_(r[COL.msgs], {}),
    });
  }
  return out;
}

function leadById_(id) {
  return leads_().filter(function (l) { return l.id === id; })[0] || null;
}

function card_(l) {
  const lines = ['<b>Заявка №' + l.id + '</b> · ' + esc_(l.status), esc_(l.lang ? l.lang.charAt(0).toUpperCase() + l.lang.slice(1) : '')];
  lines.push('');
  lines.push('Имя: ' + esc_(l.name || '-'));
  lines.push('Телефон: ' + esc_(l.phone || '-'));
  if (l.tg) lines.push('Telegram: @' + esc_(l.tg));
  if (l.promo) {
    const p = findRow_(SHEET_PROMO, l.promo);
    lines.push('Промокод: ' + esc_(l.promo) + (p ? (p[2] === 'да' ? ' (' + esc_(p[1]) + ')' : ' (выключен)') : ' <i>(такого кода нет)</i>'));
  }
  if (l.ref) {
    const r = findRow_(SHEET_REFS, l.ref);
    lines.push('По ссылке от: ' + (r ? esc_(r[1]) : 'неизвестно') + ' (' + esc_(l.ref) + ')');
  }
  lines.push('Пришла: ' + esc_(l.date));
  if (l.by) lines.push('Статус поставил(а): ' + esc_(l.by) + ', ' + esc_(l.at));

  const rows = [];
  const reply = templateFor_(l);
  const contact = [];
  if (l.tg) contact.push({ text: 'Ответить в Telegram', url: urlWithText_('https://t.me/' + l.tg, reply) });
  const digits = l.phone.replace(/\D/g, '');
  if (digits.length >= 10) contact.push({ text: 'WhatsApp', url: urlWithText_('https://wa.me/' + digits, reply) });
  if (contact.length) rows.push(contact);
  rows.push([{ text: 'Текст ответа', callback_data: 't:' + l.id }]);
  rows.push(['w', 'b', 'c'].map(function (code) {
    return { text: (l.status === STATUSES[code] ? '• ' : '') + STATUSES[code], callback_data: 's:' + l.id + ':' + code };
  }));
  return { text: lines.join('\n'), markup: { inline_keyboard: rows } };
}

// Длинный шаблон в ссылке может не влезть: тогда открываем чат без текста,
// а текст бот пришлёт по кнопке «Текст ответа».
function urlWithText_(base, text) {
  const url = base + '?text=' + encodeURIComponent(text);
  return url.length <= 2000 ? url : base;
}

function notifyNewLead_(id) {
  const l = leadById_(id);
  if (!l) return;
  const c = card_(l);
  const msgs = {};
  Object.keys(admins_()).forEach(function (admin) {
    const mid = send_(Number(admin), 'Новая заявка с сайта\n\n' + c.text, c.markup);
    if (mid) msgs[admin] = mid;
  });
  setCell_(l.row, COL.msgs, JSON.stringify(msgs));
}

function refreshCards_(id) {
  const l = leadById_(id);
  if (!l) return;
  const c = card_(l);
  const admins = admins_();
  Object.keys(l.msgs).forEach(function (admin) {
    if (admins[admin]) edit_(Number(admin), l.msgs[admin], c.text, c.markup);
  });
}

function showByStatus_(id, status, emptyText) {
  const list = leads_().filter(function (l) { return l.status === status; });
  if (!list.length) return send_(id, emptyText, menu_(id));
  const shown = list.slice(0, 15);
  shown.forEach(function (l) { sendCard_(id, l); });
  if (list.length > shown.length) {
    send_(id, 'Показаны первые ' + shown.length + ' из ' + list.length + '. Остальные в таблице: ' + esc_(SpreadsheetApp.getActive().getUrl()));
  }
}

function sendCard_(admin, l) {
  const c = card_(l);
  const mid = send_(admin, c.text, c.markup);
  if (mid) {
    l.msgs[admin] = mid;
    setCell_(l.row, COL.msgs, JSON.stringify(l.msgs));
  }
}

function showAll_(id) {
  const list = leads_().slice(-10).reverse();
  if (!list.length) return send_(id, 'Заявок пока нет.', menu_(id));
  const rows = list.map(function (l) {
    return [{ text: '№' + l.id + ' · ' + (l.name || 'без имени').slice(0, 20) + ' · ' + l.status.toLowerCase(), callback_data: 'o:' + l.id }];
  });
  rows.push([{ text: 'Открыть таблицу со всеми заявками', url: SpreadsheetApp.getActive().getUrl() }]);
  send_(id, '<b>Последние заявки</b>\nНажмите на заявку, чтобы открыть её.', { inline_keyboard: rows });
}

// ---------------------------------------------------------------- шаблон ответа

function template_() {
  return PropertiesService.getScriptProperties().getProperty('template') || DEFAULT_TEMPLATE;
}

function templateFor_(l) {
  let t = template_();
  t = l.name ? t.split('{имя}').join(l.name) : t.replace(/,? ?\{имя\}/g, '');
  t = t.split('{языка}').join(l.lang === 'польский' ? 'польского' : 'английского');
  t = t.split('{промокод}').join(l.promo || '');
  return t;
}

function showTemplate_(id) {
  send_(id, '<b>Шаблон ответа</b>\nЕго вставят кнопки «Ответить в Telegram» и «WhatsApp». Можно использовать {имя}, {языка}, {промокод}.\n\n' + esc_(template_()), {
    inline_keyboard: [[{ text: 'Изменить текст', callback_data: 'te' }, { text: 'Вернуть стандартный', callback_data: 'tr' }]],
  });
}

function saveTemplate_(id, text) {
  const t = cleanText_(text, 1500, true);
  if (!t) return send_(id, 'Нужен текст. Нажмите «Шаблон ответа» ещё раз.', menu_(id));
  PropertiesService.getScriptProperties().setProperty('template', t);
  send_(id, 'Шаблон сохранён. Пример для Анны:\n\n' + esc_(templateFor_({ name: 'Анна', lang: 'английский', promo: '' })), menu_(id));
}

// ---------------------------------------------------------------- промокоды

function showPromos_(id) {
  const rows = rows_(SHEET_PROMO);
  const lines = ['<b>Промокоды</b>', 'Человек вписывает код в форму на сайте, а в заявке видно, что это за код. Скидку вы считаете сами при оплате.'];
  const kb = [];
  if (!rows.length) lines.push('', 'Пока нет ни одного кода.');
  rows.forEach(function (r) {
    lines.push('', '<b>' + esc_(r[0]) + '</b>: ' + esc_(r[1]) + (r[2] === 'да' ? '' : ' <i>(выключен)</i>') + ', заявок: ' + Number(r[3] || 0));
    kb.push([{ text: (r[2] === 'да' ? 'Выключить ' : 'Включить ') + r[0], callback_data: 'pt:' + r[0] }]);
  });
  lines.push('', 'Ссылка сразу с кодом: ' + esc_(CONFIG.SITE_URL) + '?promo=КОД');
  kb.push([{ text: 'Добавить промокод', callback_data: 'pa' }]);
  send_(id, lines.join('\n'), { inline_keyboard: kb });
}

function addPromo_(id, text) {
  const m = String(text).trim().match(/^([A-Za-z0-9_-]{2,20})\s+(.{2,100})$/);
  if (!m) return send_(id, 'Не понял. Пришлите так: КОД описание, например:\nVESNA10 скидка 10% на первый пакет', menu_(id));
  const code = m[1].toUpperCase();
  if (findRow_(SHEET_PROMO, code)) return send_(id, 'Такой код уже есть.', menu_(id));
  sheet_(SHEET_PROMO).appendRow([code, cleanText_(m[2], 100), 'да', 0].map(safe_));
  send_(id, 'Промокод <b>' + esc_(code) + '</b> добавлен.\nСсылка, где он уже вписан в форму:\n' + esc_(CONFIG.SITE_URL) + '?promo=' + esc_(code), menu_(id));
}

// ---------------------------------------------------------------- рефералы

function showRefs_(id) {
  const rows = rows_(SHEET_REFS);
  const lines = ['<b>Реферальные ссылки</b>', 'Дайте ученику его ссылку: заявки тех, кто пришёл по ней, будут помечены его именем.'];
  if (!rows.length) lines.push('', 'Пока нет ни одной ссылки.');
  rows.forEach(function (r) {
    lines.push('', '<b>' + esc_(r[1]) + '</b>: заявок ' + Number(r[3] || 0) + '\n' + esc_(r[2]));
  });
  send_(id, lines.join('\n'), { inline_keyboard: [[{ text: 'Создать ссылку', callback_data: 'ra' }]] });
}

function addRef_(id, text) {
  const who = cleanText_(text, 60);
  if (who.length < 2) return send_(id, 'Пришлите имя того, кому делаем ссылку, например: Анна Иванова', menu_(id));
  let code;
  do { code = randomCode_(6); } while (findRow_(SHEET_REFS, code));
  const link = CONFIG.SITE_URL + '?ref=' + code;
  sheet_(SHEET_REFS).appendRow([code, who, link, 0, now_()].map(safe_));
  send_(id, 'Ссылка для ' + esc_(who) + ':\n' + esc_(link) + '\n\nПерешлите её ученику. Заявки по ней будут помечены «По ссылке от: ' + esc_(who) + '».', menu_(id));
}

// ---------------------------------------------------------------- админы

function showAdmins_(id) {
  const a = admins_();
  const lines = ['<b>Админы бота</b>'];
  const kb = [];
  Object.keys(a).forEach(function (aid) {
    lines.push('• ' + esc_(a[aid].name) + (a[aid].username ? ' (@' + esc_(a[aid].username) + ')' : '') + (a[aid].role === 'owner' ? ', владелец' : ''));
    if (a[aid].role !== 'owner') kb.push([{ text: 'Убрать ' + a[aid].name.slice(0, 20), callback_data: 'ad:' + aid }]);
  });
  const props = PropertiesService.getScriptProperties();
  const bound = JSON.parse(props.getProperty('bound') || '{}');
  const waiting = CONFIG.ADMIN_USERNAMES.concat(JSON.parse(props.getProperty('pending') || '[]'))
    .filter(function (u, i, arr) { return arr.indexOf(u) === i && bound[u] === undefined; });
  if (waiting.length) lines.push('', 'Ещё не открыли бота: ' + waiting.map(function (u) { return '@' + esc_(u); }).join(', '));
  kb.push([{ text: 'Добавить админа', callback_data: 'aa' }]);
  send_(id, lines.join('\n'), { inline_keyboard: kb });
}

function addAdmin_(id, text) {
  const username = String(text).trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{5,32}$/.test(username)) return send_(id, 'Пришлите имя в виде @username.', menu_(id));
  const props = PropertiesService.getScriptProperties();
  const pending = JSON.parse(props.getProperty('pending') || '[]');
  if (pending.indexOf(username) === -1) pending.push(username);
  props.setProperty('pending', JSON.stringify(pending));
  const bound = JSON.parse(props.getProperty('bound') || '{}');
  if (bound[username] === -1) { delete bound[username]; props.setProperty('bound', JSON.stringify(bound)); }
  send_(id, '@' + esc_(username) + ' станет админом, когда откроет этого бота и нажмёт «Старт».', menu_(id));
}

// ---------------------------------------------------------------- кнопки

function onCallback_(q) {
  const id = q.from && q.from.id;
  const data = String(q.data || '');
  const msg = q.message || {};
  if (!id || !/^[a-z]{1,2}(:[A-Za-z0-9_-]{1,20}){0,2}$/.test(data) || (msg.chat && msg.chat.type !== 'private')) {
    answer_(q.id);
    return;
  }
  maybePromote_(q.from);
  if (!isAdmin_(id)) { answer_(q.id, 'Эта кнопка только для админов.'); return; }

  const p = data.split(':');
  const leadId = p[1] && /^\d+$/.test(p[1]) ? Number(p[1]) : 0;
  const cache = CacheService.getScriptCache();

  switch (p[0]) {
    case 'o': {
      answer_(q.id);
      const l = leadById_(leadId);
      if (l) sendCard_(id, l); else send_(id, 'Заявка не найдена.');
      return;
    }
    case 's': {
      const l = leadById_(leadId);
      if (!l || !STATUSES[p[2]]) { answer_(q.id, 'Заявка не найдена.'); return; }
      const status = l.status === STATUSES[p[2]] ? STATUSES.n : STATUSES[p[2]]; // повторное нажатие снимает отметку
      setCell_(l.row, COL.status, status);
      setCell_(l.row, COL.by, admins_()[id].name);
      setCell_(l.row, COL.at, now_());
      answer_(q.id, 'Статус: ' + status);
      refreshCards_(leadId);
      return;
    }
    case 't': {
      answer_(q.id);
      const l = leadById_(leadId);
      if (l) send_(id, 'Текст ответа для ' + esc_(l.name || 'ученика') + ' (скопируйте и отправьте):\n\n' + esc_(templateFor_(l)));
      return;
    }
    case 'te': answer_(q.id); cache.put('st_' + id, 'te', 3600); send_(id, 'Пришлите новый шаблон ответа одним сообщением. Можно {имя}, {языка}, {промокод}.', cancelKb_()); return;
    case 'tr': answer_(q.id, 'Вернул стандартный'); PropertiesService.getScriptProperties().deleteProperty('template'); return;
    case 'pa': answer_(q.id); cache.put('st_' + id, 'pa', 3600); send_(id, 'Пришлите код и описание одним сообщением, например:\nVESNA10 скидка 10% на первый пакет', cancelKb_()); return;
    case 'pt': {
      const r = findRow_(SHEET_PROMO, String(p[1] || '').toUpperCase(), true);
      if (!r) { answer_(q.id, 'Код не найден.'); return; }
      const on = r.values[2] === 'да';
      sheet_(SHEET_PROMO).getRange(r.row, 3).setValue(on ? 'нет' : 'да');
      answer_(q.id, on ? 'Выключен' : 'Включён');
      showPromos_(id);
      return;
    }
    case 'ra': answer_(q.id); cache.put('st_' + id, 'ra', 3600); send_(id, 'Для кого ссылка? Пришлите имя, например: Анна Иванова', cancelKb_()); return;
    case 'aa':
      if (!isOwner_(id)) { answer_(q.id, 'Только для владельца.'); return; }
      answer_(q.id); cache.put('st_' + id, 'aa', 3600); send_(id, 'Пришлите имя нового админа в виде @username.', cancelKb_()); return;
    case 'ad': {
      if (!isOwner_(id)) { answer_(q.id, 'Только для владельца.'); return; }
      const a = admins_();
      const target = String(p[1] || '');
      if (!a[target] || a[target].role === 'owner') { answer_(q.id); return; }
      const removed = a[target];
      delete a[target];
      saveAdmins_(a);
      const props = PropertiesService.getScriptProperties();
      if (removed.username) {
        const bound = JSON.parse(props.getProperty('bound') || '{}');
        bound[removed.username] = -1; // имя из настроек больше не даёт доступ
        props.setProperty('bound', JSON.stringify(bound));
        props.setProperty('pending', JSON.stringify(JSON.parse(props.getProperty('pending') || '[]').filter(function (u) { return u !== removed.username; })));
      }
      tg_('sendMessage', { chat_id: Number(target), text: 'Доступ к кабинету заявок закрыт.', reply_markup: { remove_keyboard: true } });
      answer_(q.id, 'Готово');
      send_(id, esc_(removed.name) + ' больше не админ.');
      return;
    }
    case 'x':
      cache.remove('st_' + id);
      answer_(q.id, 'Отменено');
      if (msg.message_id) edit_(id, msg.message_id, 'Отменено.');
      return;
  }
  answer_(q.id);
}

function cancelKb_() {
  return { inline_keyboard: [[{ text: 'Отмена', callback_data: 'x' }]] };
}

// ---------------------------------------------------------------- таблица

// Лист по имени; если его нет, создаётся сразу со строкой заголовков.
function sheet_(name) {
  const headers = HEADERS[name];
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers) {
      sh.appendRow(headers);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }
  return sh;
}

function rows_(name) {
  return sheet_(name).getDataRange().getValues().slice(1).filter(function (r) { return r[0] !== ''; })
    .map(function (r) { return r.map(unsafe_); });
}

// Ищет строку по коду в первом столбце. withRow: вернуть ещё и номер строки.
function findRow_(name, code, withRow) {
  const values = sheet_(name).getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (unsafe_(values[i][0]).toLowerCase() === String(code).toLowerCase()) {
      const vals = values[i].map(unsafe_);
      return withRow ? { row: i + 1, values: vals } : vals;
    }
  }
  return null;
}

function bumpCounter_(name, code, col) {
  const r = findRow_(name, code, true);
  if (r) sheet_(name).getRange(r.row, col + 1).setValue(Number(r.values[col] || 0) + 1);
}

function setCell_(row, col, value) {
  sheet_(SHEET_LEADS).getRange(row, col + 1).setValue(safe_(value));
}

// ---------------------------------------------------------------- мелочи

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function now_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd.MM.yyyy HH:mm');
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Текст из формы или от админа: без управляющих символов и лишних пробелов.
function cleanText_(v, max, multiline) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, '');
  s = multiline ? s.replace(/[ \t]+/g, ' ') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

// Любой текст пишем в таблицу именно как текст (апостроф в начале таблица не показывает).
// Так «=СУММ(...)» из формы не станет формулой, телефон не станет числом, а дата датой.
function safe_(v) {
  if (typeof v !== 'string' || v === '') return v;
  return "'" + v;
}

function unsafe_(v) {
  const s = String(v == null ? '' : v);
  return s.charAt(0) === "'" ? s.slice(1) : s;
}

function parseJson_(v, fallback) {
  try { return v ? JSON.parse(String(v)) : fallback; } catch (err) { return fallback; }
}

function randomCode_(len) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

// ---------------------------------------------------------------- для запуска вручную

// Проверка: в редакторе выберите checkSetup и нажмите «Выполнить».
function checkSetup() {
  sheet_(SHEET_LEADS);
  sheet_(SHEET_PROMO);
  sheet_(SHEET_REFS);
  const me = tg_('getMe', {});
  console.log(me ? 'Бот @' + me.username + ' на связи, листы таблицы готовы.' : 'Telegram не ответил: проверьте TOKEN в CONFIG.');
}

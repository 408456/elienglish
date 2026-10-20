/* eli english: поведение страницы */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Данные ---------- */

  // Тексты страниц лежат в index.html, польская страница собирается командой
  // node tools/build.mjs. Здесь только цены и логика.

  // Куда форма «Первый урок бесплатно» отправляет заявку: веб-приложение Google Apps Script
  // (google/bot.gs). Оно пишет заявку в Google Таблицу, присылает её в бота заявок
  // и проверяет промокоды.
  var LEADS_URL = 'https://script.google.com/macros/s/AKfycbzl_Q29J0lezSbkuDxqMutdh8GyEBBaAh3a4npjuFhYISAN1e-gjT02rum4dl1PrIVuVQ/exec';
  // Личный Telegram преподавателя: сюда ведут «Написать в Telegram» и нижний блок записи.
  var PERSONAL_TG = 'Eligolc';

  // Цена одного урока онлайн. Лично: +1000 ₽ (видно только в ценах).
  var BASE = { en: { 60: 1500, 90: 2000 }, pl: { 60: 2000, 90: 2500 } };
  var OFFLINE_EXTRA = 1000;

  // Порядок как в референсе: от большого пакета к маленькому.
  var PACKS = [
    { n: 40, off: 15, best: true, sub: 'Курс на новый уровень', term: '≈ 5 месяцев, 2 урока в неделю', report: true, freeze: true },
    { n: 20, off: 10, sub: 'Заметите прогресс', term: '≈ 2,5 месяца, 2 урока в неделю', report: true, freeze: false },
    { n: 10, off: 5, sub: 'Привыкнете говорить', term: '≈ 5 недель, 2 урока в неделю', report: false, freeze: false },
    { n: 5, off: 0, sub: 'Попробуете формат', term: '≈ 2,5 недели, 2 урока в неделю', report: false, freeze: false }
  ];

  // Программы под цель: готовый план на известное число уроков.
  // Скидка такая же, как у абонемента того же размера (offFor ниже).
  var PROGRAMS = {
    en: [
      { id: 'kickoff', name: 'Kick-off', tag: 'Спринт A0 → A1', title: 'Английский с нуля', n: 24, term: '≈ 3 месяца, 2 урока в неделю',
        points: ['Расскажете о себе, семье и работе', 'Закажете еду, купите билет, спросите дорогу', 'Поймёте простую речь, если говорят не спеша'] },
      { id: 'levelup', name: 'Level up', tag: 'Спринт A1 → A2', title: 'Уверенная база', n: 24, term: '≈ 3 месяца, 2 урока в неделю',
        points: ['Поддержите разговор на бытовые темы', 'Расскажете, что было, и обсудите планы', 'Напишете письмо или сообщение без переводчика'] },
      { id: 'boarding', name: 'Boarding pass', tag: 'Путешествия', title: 'Английский в дорогу', n: 10, term: '≈ 5 недель, 2 урока в неделю',
        points: ['Аэропорт, отель, такси, кафе, магазин', 'Слова и фразы под ваш маршрут', 'Что сказать, если что-то пошло не так'] },
      { id: 'offer', name: 'Job offer', tag: 'Работа', title: 'Собеседование на английском', n: 12, term: '≈ 6 недель, 2 урока в неделю',
        points: ['Рассказ о себе и своём опыте', 'Ответы на частые вопросы работодателя', 'Пробное собеседование с разбором'] }
    ],
    pl: [
      { id: 'karta', name: 'Karta Polaka', tag: 'Собеседование', title: 'Собеседование на Карту поляка', n: 16, term: '≈ 2 месяца, 2 урока в неделю',
        points: ['Уверенный рассказ о себе и своей семье', 'История, традиции, праздники и география Польши', 'Пробные собеседования, как у консула'] },
      { id: 'witaj', name: 'Witaj w Polsce', tag: 'Переезд', title: 'Польский для переезда', n: 20, term: '≈ 2,5 месяца, 2 урока в неделю',
        points: ['Документы, банк, аренда жилья, врач', 'Разговор с соседями и коллегами', 'Заявления и письма на польском'] },
      { id: 'praca', name: 'Praca', tag: 'Работа', title: 'Собеседование с работодателем', n: 12, term: '≈ 6 недель, 2 урока в неделю',
        points: ['Рассказ о себе и своём опыте', 'Ответы на частые вопросы работодателя', 'Пробное собеседование с разбором'] },
      { id: 'b1', name: 'Certyfikat B1', tag: 'Экзамен', title: 'Государственный экзамен B1', n: 24, term: '≈ 3 месяца, 2 урока в неделю',
        points: ['Все пять частей: аудирование, чтение, грамматика, письмо, речь', 'Пробные экзамены на время', 'Сертификат B1 нужен, например, для гражданства'] }
    ]
  };

  // Подарочный сертификат: уроки по 60 минут, скидка как у абонемента того же размера.
  var GIFTS = [5, 10, 20];

  var state = {
    lang: root.dataset.lang === 'pl' ? 'pl' : 'en',
    format: 'online',
    dur: 60,
    choice: null, // абонемент или программа, которую выбрали в ценах: { label, msg }
    giftN: 10,
    giftFormat: 'online',
    promo: null // { code: 'VESNA10', off: 10 }, когда код проверен
  };

  var nf = new Intl.NumberFormat('ru-RU');
  function rub(n) { return nf.format(n) + ' ₽'; }

  // 1 урок, 2 урока, 5 уроков, 21 урок
  function lessons(n) {
    var d = n % 10, h = n % 100;
    return n + (d === 1 && h !== 11 ? ' урок' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? ' урока' : ' уроков');
  }

  function lessonPrice(lang, format, dur) {
    return BASE[lang][dur] + (format === 'offline' ? OFFLINE_EXTRA : 0);
  }

  // скидка за количество уроков, как у абонементов: 40 → 15%, 20 → 10%, 10 → 5%
  function offFor(n) {
    var off = 0;
    PACKS.forEach(function (p) { if (n >= p.n && p.off > off) off = p.off; });
    return off;
  }

  // Скидка промокода прибавляется к скидке пакета: 15% + 10% = 25%.
  function priceFor(n, off, format, dur, promo) {
    var full = lessonPrice(state.lang, format, dur);
    off = Math.min(off + (promo ? promo.off : 0), 60);
    var per = Math.floor(full * (100 - off) / 100 / 10) * 10;
    return { per: per, total: per * n, full: full * n, off: off };
  }

  function packPrice(n, off) { return priceFor(n, off, state.format, state.dur, state.promo); }

  /* ---------- Цели Яндекс Метрики (работают, только если она подключена) ---------- */

  var metrikaEl = document.querySelector('script[data-metrika]');
  function goal(name) {
    var id = metrikaEl ? Number(metrikaEl.dataset.metrika) : 0;
    if (id && window.ym) { try { window.ym(id, 'reachGoal', name); } catch (e) {} }
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    if (a.href.indexOf('https://t.me/') === 0) goal('telegram');
    else if (a.href.indexOf('tel:') === 0) goal('call');
  });

  /* ---------- Откуда пришёл человек ---------- */

  // Метка из ссылки (?from=avito или ?utm_source=avito&utm_campaign=...), реклама Директа
  // и Google или сайт, с которого перешли (поиск Яндекса, Telegram, ВКонтакте...).
  // Помним 90 дней и отправляем вместе с заявкой: в боте и в таблице видно, откуда она.
  // Метка из ссылки всегда главнее; прямой заход старый источник не стирает.
  var SOURCE_KEY = 'eli-source';
  var SITES = [
    [/(^|\.)yandex\.|(^|\.)ya\.ru$/, 'Яндекс'], [/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'],
    [/(^|\.)(t\.me|telegram\.(me|org))$/, 'Telegram'], [/(^|\.)(vk\.com|vk\.ru)$/, 'ВКонтакте'],
    [/(^|\.)avito\.ru$/, 'Авито'], [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)2gis\./, '2ГИС'],
    [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp'], [/(^|\.)mail\.ru$/, 'Mail.ru'], [/(^|\.)dzen\.ru$/, 'Дзен']
  ];

  function cleanTag(v) { return String(v || '').replace(/[^\p{L}\p{N} ._\/-]/gu, '').trim().slice(0, 40); }

  var source = (function () {
    var p = new URLSearchParams(location.search);
    var tag = [cleanTag(p.get('from') || p.get('utm_source')), cleanTag(p.get('utm_medium')), cleanTag(p.get('utm_campaign'))]
      .filter(Boolean).join(' / ');
    if (!tag && p.get('yclid')) tag = 'Яндекс Директ';
    if (!tag && p.get('gclid')) tag = 'Google Ads';
    var ref = '';
    try {
      var host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : '';
      if (host && host !== location.hostname) {
        ref = host;
        SITES.forEach(function (s) { if (s[0].test(host)) ref = s[1]; });
      }
    } catch (e) {}
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(SOURCE_KEY) || 'null');
      if (saved && !(Date.now() - saved.at < 90 * 864e5)) saved = null;
    } catch (e) {}
    var now = tag || (!saved && ref);
    if (now) {
      saved = { src: now, at: Date.now() };
      try { localStorage.setItem(SOURCE_KEY, JSON.stringify(saved)); } catch (e) {}
    }
    return saved ? saved.src : 'прямой заход';
  })();

  /* ---------- Плавная смена чисел ---------- */

  function tweenNumber(el, to) {
    var from = Number(el.dataset.value);
    el.dataset.value = to;
    if (reduceMotion || document.hidden || isNaN(from) || from === to) {
      el.textContent = rub(to);
      return;
    }
    var start = performance.now();
    function step(now) {
      var t = Math.min(1, (now - start) / 520);
      var v = Math.round((from + (to - from) * (1 - Math.pow(1 - t, 3))) / 10) * 10;
      el.textContent = rub(t === 1 ? to : v);
      if (t < 1 && Number(el.dataset.value) === to) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    // страховка: в фоновой вкладке анимация не идёт, а цена должна быть верной
    setTimeout(function () { if (Number(el.dataset.value) === to) el.textContent = rub(to); }, 600);
  }

  /* ---------- Цены ---------- */

  var pricingEl = document.getElementById('pricing');
  var onePriceEl = document.querySelector('[data-price="one"]');

  // Бонус есть в пакете: галочка. Нет: подсказка, в каком пакете он появится.
  function feature(on, text, hint) {
    if (on) return '<li>' + text + '</li>';
    return '<li class="is-later"><span class="price__plus" aria-hidden="true"></span>' + text +
      '<span class="price__hint">' + hint + '</span></li>';
  }

  function wasHtml(c) {
    return c.off ? '<s>' + rub(c.full) + '</s><span class="price__off">−' + c.off + '%</span>' : 'без скидки';
  }

  function buildPricing() {
    pricingEl.innerHTML = PACKS.map(function (p) {
      return (
        '<article class="price reveal' + (p.best ? ' price--best' : '') + '">' +
          '<h4 class="price__name">' + lessons(p.n) + '</h4>' +
          (p.best ? '<span class="price__badge">Выгоднее всего</span>' : '') +
          '<p class="price__sub">' + p.sub + '</p>' +
          '<p class="price__term">' + p.term + '</p>' +
          '<ul class="price__list">' +
            '<li data-k="lesson">Индивидуальные уроки по 60 минут</li>' +
            feature(p.report, 'Отчёт о прогрессе раз в месяц', 'в абонементах от 20 уроков') +
            feature(p.freeze, 'Заморозка абонемента на время отпуска или болезни', 'в абонементе на 40 уроков') +
          '</ul>' +
          '<div class="price__per"><span class="price__num" data-k="per"></span><span class="price__unit">за урок</span></div>' +
          '<p class="price__total"><b data-k="total"></b> за абонемент</p>' +
          '<p class="price__was" data-k="was"></p>' +
          '<button type="button" class="btn ' + (p.best ? 'btn--white' : 'btn--ghost') + '" data-pack="' + p.n + '">Записаться</button>' +
        '</article>'
      );
    }).join('');

    programsEl.innerHTML = programs.map(function (p) {
      return (
        '<article class="prog reveal">' +
          '<p class="prog__top"><span>' + p.tag + '</span><span>' + lessons(p.n) + '</span></p>' +
          '<h4 class="prog__name">' + p.name + '</h4>' +
          '<p class="prog__title">' + p.title + '</p>' +
          '<p class="price__term">' + p.term + '</p>' +
          '<ul class="price__list">' + p.points.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
          '<div class="prog__price">' +
            '<span class="price__num" data-k="total"></span>' +
            '<span class="price__unit">по <b data-k="per"></b> за урок</span>' +
          '</div>' +
          '<p class="price__was" data-k="was"></p>' +
          '<button type="button" class="btn btn--ghost" data-program="' + p.id + '">Выбрать программу</button>' +
        '</article>'
      );
    }).join('');
  }

  function renderPrices() {
    var cards = pricingEl.querySelectorAll('.price');
    PACKS.forEach(function (p, i) {
      var c = packPrice(p.n, p.off);
      var card = cards[i];
      tweenNumber(card.querySelector('[data-k="per"]'), c.per);
      card.querySelector('[data-k="total"]').textContent = rub(c.total);
      card.querySelector('[data-k="was"]').innerHTML = wasHtml(c);
      card.querySelector('[data-k="lesson"]').textContent = 'Индивидуальные уроки по ' + state.dur + ' минут';
    });
    var progCards = programsEl.querySelectorAll('.prog');
    programs.forEach(function (p, i) {
      var c = packPrice(p.n, offFor(p.n));
      tweenNumber(progCards[i].querySelector('[data-k="total"]'), c.total);
      progCards[i].querySelector('[data-k="per"]').textContent = rub(c.per);
      progCards[i].querySelector('[data-k="was"]').innerHTML = wasHtml(c);
    });
    tweenNumber(onePriceEl, lessonPrice(state.lang, state.format, state.dur));
  }

  var programsEl = document.getElementById('programs');
  var programs = PROGRAMS[state.lang];
  buildPricing();

  document.querySelectorAll('input[name="p-format"]').forEach(function (input) {
    input.addEventListener('change', function () { state.format = input.value; renderPrices(); });
  });
  document.querySelectorAll('input[name="p-dur"]').forEach(function (input) {
    input.addEventListener('change', function () { state.dur = Number(input.value); renderPrices(); });
  });

  /* ---------- Промокод ---------- */

  // Поле есть в ценах и в форме пробного урока, они всегда показывают один и тот же код.
  // Код проверяет веб-приложение Google (лист «Промокоды» в таблице заявок),
  // после проверки цены пакетов сразу пересчитываются.
  // Ссылка вида сайт/?promo=VESNA10 вписывает код сам и помнит его 30 дней.
  var PROMO_KEY = 'eli-promo';
  var promoBox = document.getElementById('promo');
  var promoInput = document.getElementById('promo-input');
  var promoBtn = document.getElementById('promo-btn');
  var form = document.getElementById('trial-form');
  var formPromo = form.elements.promo;
  var promoInputs = [promoInput, formPromo];
  var promoNotes = document.querySelectorAll('[data-promo-note]');
  var promoChecked = {}; // код -> ответ сервера, чтобы не спрашивать дважды
  var promoSeq = 0;
  var promoTimer = 0;

  function normCode(value) { return String(value || '').trim().toUpperCase(); }
  function isCode(code) { return /^[A-Z0-9_-]{2,20}$/.test(code); }

  function savePromo(code) {
    try {
      if (code) localStorage.setItem(PROMO_KEY, JSON.stringify({ code: code, at: Date.now() }));
      else localStorage.removeItem(PROMO_KEY);
    } catch (e) {}
  }

  function setPromoNote(text, ok) {
    promoNotes.forEach(function (el) {
      el.textContent = text;
      el.classList.toggle('is-ok', Boolean(ok));
    });
    promoBox.classList.toggle('is-ok', Boolean(ok));
  }

  function updatePromoBtn() {
    var code = normCode(promoInput.value);
    var applied = state.promo && state.promo.code === code;
    promoBtn.textContent = applied ? 'Убрать' : 'Применить';
    promoBtn.disabled = !applied && !code;
  }

  function setPromo(promo, note) {
    var changed = (state.promo && state.promo.code) !== (promo && promo.code);
    state.promo = promo;
    setPromoNote(promo ? 'Промокод действует: −' + promo.off + '% к цене абонементов и программ' : (note || ''), Boolean(promo));
    updatePromoBtn();
    if (changed) {
      renderPrices();
      updateSignup();
    }
  }

  function checkPromo(code) {
    if (!LEADS_URL) return Promise.resolve(null);
    if (!promoChecked[code]) {
      promoChecked[code] = fetch(LEADS_URL + '?promo=' + encodeURIComponent(code))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          return data && data.ok && Number(data.off) > 0
            ? { ok: true, off: Math.min(Number(data.off), 50) }
            : { ok: false };
        })
        .catch(function () {
          delete promoChecked[code]; // нет связи: в следующий раз спросим снова
          return null;
        });
    }
    return promoChecked[code];
  }

  // source: поле, в котором человек печатает (второе поле получает тот же текст)
  function applyPromo(value, source, quiet) {
    var code = normCode(value);
    promoInputs.forEach(function (input) { if (input !== source) input.value = code; });
    clearTimeout(promoTimer);
    var seq = ++promoSeq;
    if (!code) { setPromo(null, ''); savePromo(''); return; }
    if (!isCode(code)) { setPromo(null, 'В промокоде только латинские буквы и цифры'); return; }
    if (state.promo && state.promo.code === code) { updatePromoBtn(); return; }
    setPromo(null, quiet ? '' : 'Проверяем промокод…');
    checkPromo(code).then(function (result) {
      if (seq !== promoSeq) return; // человек уже ввёл другой код
      if (!result) {
        setPromo(null, quiet ? '' : 'Не получилось проверить код. Оставьте заявку, и мы учтём скидку.');
      } else if (result.ok) {
        setPromo({ code: code, off: result.off });
        savePromo(code);
      } else if (quiet) {
        // сохранённый код больше не действует: молча убираем
        promoInputs.forEach(function (input) { input.value = ''; });
        setPromo(null, '');
        savePromo('');
      } else {
        setPromo(null, 'Такого промокода нет');
      }
    });
  }

  promoInputs.forEach(function (input) {
    input.addEventListener('input', function () {
      var code = normCode(input.value);
      promoInputs.forEach(function (other) { if (other !== input) other.value = code; });
      clearTimeout(promoTimer);
      promoSeq++;
      if (state.promo && state.promo.code !== code) setPromo(null, '');
      else if (!state.promo) setPromoNote('', false);
      updatePromoBtn();
      // проверяем сами, когда человек перестал печатать
      if (isCode(code) && code.length >= 3) promoTimer = setTimeout(function () { applyPromo(code, input); }, 700);
    });
    input.addEventListener('blur', function () {
      var code = normCode(input.value);
      if (code && !(state.promo && state.promo.code === code)) applyPromo(code, input);
    });
  });

  promoInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); applyPromo(promoInput.value, promoInput); }
  });

  promoBtn.addEventListener('click', function () {
    if (state.promo && state.promo.code === normCode(promoInput.value)) {
      promoInputs.forEach(function (input) { input.value = ''; });
      applyPromo('', null);
      promoInput.focus();
    } else {
      applyPromo(promoInput.value, promoInput);
    }
  });

  // Промокод из ссылки (?promo=КОД) или сохранённый в прошлый раз
  (function () {
    var params = new URLSearchParams(location.search);
    var fromLink = normCode(params.get('promo'));
    var saved = '';
    try {
      var s = JSON.parse(localStorage.getItem(PROMO_KEY) || 'null');
      if (s && Date.now() - s.at < 30 * 864e5) saved = normCode(s.code);
    } catch (e) {}
    if (params.has('promo') || params.has('ref')) {
      params.delete('promo');
      params.delete('ref');
      var qs = params.toString();
      try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) {}
    }
    var code = isCode(fromLink) ? fromLink : saved;
    if (isCode(code)) applyPromo(code, null, !fromLink);
    updatePromoBtn();
  })();

  /* ---------- Сообщения преподавателю в Telegram ---------- */

  // Все кнопки «Написать в Telegram» открывают чат с Елизаветой, где уже вписано сообщение:
  // человеку остаётся нажать «Отправить».
  var HELLO = 'Здравствуйте, Елизавета! ';

  function tgLink(text) {
    return 'https://t.me/' + PERSONAL_TG + (text ? '?text=' + encodeURIComponent(text) : '');
  }

  function trialText() {
    return HELLO + 'Хочу записаться на бесплатный пробный урок ' + subjGen() + '.';
  }

  // data-tg="trial": запись на пробный урок, data-tg="question": вопрос
  document.querySelectorAll('a[data-tg]').forEach(function (a) {
    a.href = tgLink(a.dataset.tg === 'question' ? HELLO + 'У меня вопрос про уроки ' + subjGen() + ': ' : trialText());
  });

  var signupName = document.getElementById('signup-name');
  var signupMsg = document.getElementById('signup-message');
  var signupTg = document.getElementById('signup-tg');
  var packChip = document.getElementById('signup-pack');
  var packText = document.getElementById('signup-pack-text');

  function checked(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  function subjGen() {
    return (document.querySelector('[data-i18n="subjGen"]') || {}).textContent || 'английского';
  }

  function updateSignup() {
    var name = signupName.value.trim().replace(/\s+/g, ' ');
    var who = checked('who') === 'kid' ? 'ребёнок' : 'взрослый';
    var fmt = checked('fmt') === 'offline' ? 'лично' : 'онлайн';
    var msg = HELLO +
      (name ? 'Меня зовут ' + name + '. ' : '') +
      'Хочу записаться на бесплатный пробный урок ' + subjGen() + '. ' +
      'Кто будет заниматься: ' + who + '. Формат: ' + fmt + '.' +
      (state.choice ? ' ' + state.choice.msg : '') +
      (state.promo ? ' Промокод: ' + state.promo.code + '.' : '');
    signupMsg.textContent = msg;
    signupTg.href = tgLink(msg);

    if (state.choice) {
      packText.textContent = state.choice.label;
      packChip.hidden = false;
    } else {
      packChip.hidden = true;
    }
  }

  signupName.addEventListener('input', updateSignup);
  document.querySelectorAll('input[name="who"], input[name="fmt"]').forEach(function (input) {
    input.addEventListener('change', updateSignup);
  });
  document.getElementById('signup-pack-x').addEventListener('click', function () {
    state.choice = null;
    updateSignup();
  });

  // «Записаться» у абонемента и «Выбрать программу»: выбор попадает в блок записи
  document.getElementById('ceny').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-pack], [data-program]');
    if (!btn) return;
    var dur = state.dur + ' минут';
    if (btn.dataset.pack) {
      var n = lessons(Number(btn.dataset.pack));
      state.choice = { label: 'Абонемент: ' + n + ' по ' + dur, msg: 'Интересует абонемент: ' + n + ' по ' + dur + '.' };
      goal('pack');
    } else {
      var prog = programs.filter(function (x) { return x.id === btn.dataset.program; })[0];
      state.choice = {
        label: 'Программа «' + prog.name + '»: ' + lessons(prog.n) + ' по ' + dur,
        msg: 'Интересует программа «' + prog.name + '» (' + prog.title.charAt(0).toLowerCase() + prog.title.slice(1) + '), ' + lessons(prog.n) + ' по ' + dur + '.'
      };
      goal('program');
    }
    document.getElementById(state.format === 'offline' ? 'fmt-offline' : 'fmt-online').checked = true;
    updateSignup();
    document.getElementById('zapis').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  /* ---------- Подарочный сертификат ---------- */

  // Выбор количества уроков и формата сразу меняет сертификат и цену,
  // кнопка открывает чат с Елизаветой с готовым сообщением.
  var giftBtn = document.getElementById('gift-btn');
  var giftLessons = document.querySelector('[data-gift="n"]');
  var giftPrice = document.querySelector('[data-gift="price"]');
  var giftWas = document.querySelector('[data-gift="was"]');

  function updateGift() {
    var c = priceFor(state.giftN, offFor(state.giftN), state.giftFormat, 60, null);
    var fmt = state.giftFormat === 'offline' ? 'лично' : 'онлайн';
    giftLessons.textContent = lessons(state.giftN);
    tweenNumber(giftPrice, c.total);
    giftWas.innerHTML = c.off ? '<s>' + rub(c.full) + '</s> −' + c.off + '%' : '';
    giftBtn.href = tgLink(HELLO + 'Хочу подарить сертификат на ' + lessons(state.giftN) + ' ' + subjGen() +
      ' (' + fmt + ', по 60 минут) за ' + rub(c.total) + '. Подскажите, как оплатить?');
  }

  if (giftBtn) {
    document.querySelectorAll('input[name="gift-n"], input[name="gift-fmt"]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (input.name === 'gift-n') state.giftN = Number(input.value);
        else state.giftFormat = input.value;
        updateGift();
      });
    });
    giftBtn.addEventListener('click', function () { goal('gift'); });
    updateGift();
  }

  /* ---------- Язык занятий ---------- */

  // Английский и польский это две страницы (/ и /pl/), чтобы поисковики видели обе.
  // При клике бегунок и цвет плавно переезжают, потом открывается другая страница.
  document.querySelectorAll('[data-lang-link]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var target = link.dataset.langLink;
      if (target === state.lang || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      root.dataset.lang = target;
      setTimeout(function () { location.href = link.href; }, reduceMotion ? 0 : 260);
    });
  });

  renderPrices();
  updateSignup();

  /* ---------- Шапка и меню ---------- */

  var header = document.querySelector('.header');
  function onScroll() { header.classList.toggle('is-scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var burger = document.querySelector('.burger');
  var menu = document.getElementById('menu');

  function setMenu(open) {
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    menu.hidden = !open;
    document.body.classList.toggle('menu-open', open);
  }

  burger.addEventListener('click', function () { setMenu(menu.hidden); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden) { setMenu(false); burger.focus(); }
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth >= 1180 && !menu.hidden) setMenu(false);
  });

  /* ---------- Вопросы: открыт только один ---------- */

  var faqItems = document.querySelectorAll('.faq__item');
  faqItems.forEach(function (item) {
    var q = item.querySelector('.faq__q');
    q.addEventListener('click', function () {
      var open = !item.classList.contains('is-open');
      faqItems.forEach(function (other) {
        other.classList.remove('is-open');
        other.querySelector('.faq__q').setAttribute('aria-expanded', 'false');
      });
      if (open) {
        item.classList.add('is-open');
        q.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ---------- Форма пробного урока ---------- */

  var formBody = form.querySelector('.form__body');
  var stateOk = form.querySelector('.form__state--ok');
  var stateErr = form.querySelector('.form__state--error');
  var phoneInput = form.elements.phone;
  var formShownAt = Date.now(); // сервер отсекает заявки, заполненные быстрее 3 секунд

  function formatPhone(value) {
    var digits = value.replace(/\D/g, '');
    if (!digits) return '';
    if (value.trim().charAt(0) === '+' && digits.charAt(0) !== '7') return '+' + digits.slice(0, 15);
    if (digits.charAt(0) === '8') digits = '7' + digits.slice(1);
    if (digits.charAt(0) === '9') digits = '7' + digits;
    if (digits.charAt(0) !== '7') return '+' + digits.slice(0, 15);
    digits = digits.slice(0, 11);
    var out = '+7';
    if (digits.length > 1) out += ' (' + digits.slice(1, 4);
    if (digits.length >= 4) out += ')';
    if (digits.length > 4) out += ' ' + digits.slice(4, 7);
    if (digits.length > 7) out += '-' + digits.slice(7, 9);
    if (digits.length > 9) out += '-' + digits.slice(9, 11);
    return out;
  }

  phoneInput.addEventListener('input', function (e) {
    if (e.inputType && e.inputType.indexOf('delete') === 0) return;
    phoneInput.value = formatPhone(phoneInput.value);
  });
  phoneInput.addEventListener('blur', function () { phoneInput.value = formatPhone(phoneInput.value); });

  // Те же правила проверяет сервер (google/bot.gs). Ошибки показываем только после
  // нажатия «Записаться» и убираем, как только поле исправлено.
  function nameProblem(value) {
    var letters = (value.match(/\p{L}/gu) || []).length;
    if (letters < 2) return 'Напишите, как к вам обращаться';
    if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(value)) return 'Имя только буквами';
    if (value.length > 40 || value.split(' ').length > 4 || /(\p{L})\1\1/iu.test(value)) return 'Проверьте имя';
    return '';
  }

  // Россия и Казахстан: +7 и 10 цифр, код начинается с 3, 4, 7, 8 или 9. Другие страны: 10–15 цифр.
  function phoneProblem(value) {
    var d = value.replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
    var ru = d.charAt(0) === '7';
    if (d.length < (ru ? 11 : 10)) return 'Укажите номер полностью';
    if (ru ? d.length !== 11 || !/[34789]/.test(d.charAt(1)) : d.length > 15) return 'Проверьте номер';
    if (/^(\d)\1+$/.test(d.slice(ru ? 1 : 0))) return 'Проверьте номер';
    return '';
  }

  function cleanTelegram(value) {
    return value.trim().replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, '').replace(/^@/, '');
  }

  function setError(input, message) {
    var field = input.closest('.field');
    field.classList.toggle('is-invalid', Boolean(message));
    field.querySelector('.field__error').textContent = message || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function validate() {
    var name = form.elements.name;
    var tg = form.elements.telegram;
    var ok = true;
    function check(input, message) {
      setError(input, message);
      if (message) ok = false;
    }

    check(name, nameProblem(name.value.trim().replace(/\s+/g, ' ')));
    check(phoneInput, phoneProblem(phoneInput.value));
    var tgValue = cleanTelegram(tg.value);
    check(tg, tgValue && !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(tgValue) ? 'Ник в формате @username, от 5 символов' : '');
    var promo = normCode(formPromo.value);
    check(formPromo, promo && !isCode(promo) ? 'В промокоде только латинские буквы и цифры' : '');
    return ok;
  }

  form.querySelectorAll('.field__input').forEach(function (input) {
    input.addEventListener('input', function () {
      if (input.closest('.field').classList.contains('is-invalid')) validate();
    });
  });

  function prepareDraw(scope) {
    scope.querySelectorAll('svg').forEach(function (svg) {
      svg.querySelectorAll('.draw').forEach(function (el, i) {
        var len = 400;
        try { if (el.getTotalLength) len = Math.ceil(el.getTotalLength()) + 2; } catch (err) {}
        el.style.setProperty('--len', len);
        el.style.setProperty('--dd', (0.25 + i * 0.16) + 's');
      });
    });
  }

  function showState(el) {
    formBody.hidden = Boolean(el);
    stateOk.hidden = el !== stateOk;
    stateErr.hidden = el !== stateErr;
    stateOk.classList.remove('is-drawn');
    if (el === stateOk) {
      prepareDraw(stateOk);
      void stateOk.offsetWidth;
      stateOk.classList.add('is-drawn');
    }
    if (el) el.focus({ preventScroll: true });
  }

  // Заявка не ушла (нет связи или сервис недоступен). Не теряем человека:
  // предлагаем отправить ту же заявку преподавателю в Telegram готовым сообщением.
  var trialFallback = document.getElementById('trial-fallback');
  function showFallback(p) {
    trialFallback.href = tgLink(HELLO + 'Меня зовут ' + p.name + '. Хочу записаться на бесплатный пробный урок ' + subjGen() +
      '. Мой телефон: ' + p.phone + '.' + (p.telegram ? ' Telegram: @' + p.telegram + '.' : '') + (p.promo ? ' Промокод: ' + p.promo + '.' : ''));
    showState(stateErr);
  }

  function backToForm() {
    showState(null);
    form.elements.name.focus();
  }
  form.querySelector('[data-form-retry]').addEventListener('click', backToForm);
  form.querySelector('[data-form-again]').addEventListener('click', backToForm);

  // Сервер нашёл ошибку в полях (бывает редко: правила те же). Возвращаем заполненную форму.
  function showServerErrors(p, fields) {
    form.elements.name.value = p.name;
    phoneInput.value = p.phone;
    form.elements.telegram.value = p.telegram;
    var messages = { name: 'Проверьте имя', phone: 'Проверьте номер', telegram: 'Ник в формате @username, от 5 символов', promo: 'Проверьте промокод' };
    showState(null);
    fields.forEach(function (f) { if (form.elements[f]) setError(form.elements[f], messages[f]); });
  }

  // Google отвечает за 2–5 секунд, иногда дольше. Поэтому «Заявка отправлена» видно сразу,
  // а сама заявка уходит в фоне. Если она не ушла, вместо этого появится запасной вариант.
  function sendLead(p, attempt) {
    fetch(LEADS_URL, { method: 'POST', body: JSON.stringify(p) }) // без своих заголовков: так Google принимает запрос с любого сайта
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.ok) { goal('lead'); return; }
        if (data && data.error === 'fields' && Array.isArray(data.fields) && data.fields.length) showServerErrors(p, data.fields);
        else showFallback(p);
      })
      .catch(function () {
        if (attempt < 1) setTimeout(function () { sendLead(p, attempt + 1); }, 2000);
        else showFallback(p);
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) {
      var bad = form.querySelector('[aria-invalid="true"]');
      if (bad) bad.focus();
      return;
    }

    var payload = {
      kind: 'lead',
      name: form.elements.name.value.trim().replace(/\s+/g, ' '),
      phone: phoneInput.value.trim(),
      telegram: cleanTelegram(form.elements.telegram.value),
      promo: normCode(formPromo.value),
      website: form.elements.website.value,
      lang: state.lang,
      source: source,
      elapsed: Date.now() - formShownAt
    };

    if (!LEADS_URL) { showFallback(payload); return; }

    form.reset();
    formPromo.value = state.promo ? state.promo.code : '';
    showState(stateOk);
    sendLead(payload, 0);
  });

  /* ---------- Появления и счётчики ---------- */

  function countUp(el) {
    var to = Number(el.dataset.count);
    if (reduceMotion || document.hidden) { el.textContent = to; return; }
    var start = performance.now();
    el.textContent = '0';
    function step(now) {
      var t = Math.min(1, (now - start) / 1400);
      el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.classList.add('is-in');
        el.querySelectorAll('[data-count]').forEach(countUp);
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- Первый экран ---------- */

  var started = false;
  function startHero() {
    if (started) return;
    started = true;
    root.classList.add('is-loaded');
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(startHero);
  setTimeout(startHero, 700);

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();

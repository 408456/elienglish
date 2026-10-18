/* eli english: поведение страницы */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Данные ---------- */

  // Тексты страниц лежат в index.html, польская страница собирается командой
  // node tools/build.mjs. Здесь только цены и логика.
  var SITE_ROOT = new URL('../../', (document.currentScript && document.currentScript.src) || location.href);

  // Цена одного урока онлайн. Лично: +500 ₽ (видно только в ценах).
  var BASE = { en: { 60: 1500, 90: 2000 }, pl: { 60: 2000, 90: 2500 } };
  var OFFLINE_EXTRA = 500;

  // Порядок как в референсе: от большого пакета к маленькому.
  var PACKS = [
    { n: 40, off: 15, best: true, sub: 'Курс на новый уровень', term: '≈ 5 месяцев, 2 урока в неделю', report: true, freeze: true },
    { n: 20, off: 10, sub: 'Заметите прогресс', term: '≈ 2,5 месяца, 2 урока в неделю', report: true, freeze: false },
    { n: 10, off: 5, sub: 'Привыкнете говорить', term: '≈ 5 недель, 2 урока в неделю', report: false, freeze: false },
    { n: 5, off: 0, sub: 'Попробуете формат', term: '≈ 2,5 недели, 2 урока в неделю', report: false, freeze: false }
  ];

  var state = {
    lang: root.dataset.lang === 'pl' ? 'pl' : 'en',
    format: 'online',
    dur: 60,
    pack: null
  };

  var nf = new Intl.NumberFormat('ru-RU');
  function rub(n) { return nf.format(n) + ' ₽'; }

  function lessonPrice(lang, format, dur) {
    return BASE[lang][dur] + (format === 'offline' ? OFFLINE_EXTRA : 0);
  }

  function packPrice(pack) {
    var full = lessonPrice(state.lang, state.format, state.dur);
    var per = Math.floor(full * (100 - pack.off) / 100 / 10) * 10;
    return { per: per, total: per * pack.n, full: full * pack.n };
  }

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

  function buildPricing() {
    pricingEl.innerHTML = PACKS.map(function (p, i) {
      return (
        '<article class="price reveal' + (p.best ? ' price--best' : '') + '" style="--d:' + (i * 0.07) + 's">' +
          '<h3 class="price__name">' + p.n + ' уроков</h3>' +
          (p.best ? '<span class="price__badge">Выгоднее всего</span>' : '') +
          '<p class="price__sub">' + p.sub + '</p>' +
          '<p class="price__term">' + p.term + '</p>' +
          '<ul class="price__list">' +
            '<li data-k="lesson">Индивидуальные уроки по 60 минут</li>' +
            feature(p.report, 'Отчёт о прогрессе раз в месяц', 'в пакетах от 20 уроков') +
            feature(p.freeze, 'Заморозка пакета на отпуск или болезнь', 'в пакете 40 уроков') +
          '</ul>' +
          '<div class="price__per"><span class="price__num" data-k="per"></span><span class="price__unit">за урок</span></div>' +
          '<p class="price__total"><b data-k="total"></b> за пакет</p>' +
          '<p class="price__was">' +
            (p.off ? '<s data-k="full"></s><span class="price__off">−' + p.off + '%</span>' : 'без скидки') +
          '</p>' +
          '<button type="button" class="btn ' + (p.best ? 'btn--white' : 'btn--ghost') + '" data-pack="' + p.n + '">Записаться</button>' +
        '</article>'
      );
    }).join('');
  }

  function renderPrices() {
    var cards = pricingEl.querySelectorAll('.price');
    PACKS.forEach(function (p, i) {
      var c = packPrice(p);
      var card = cards[i];
      tweenNumber(card.querySelector('[data-k="per"]'), c.per);
      card.querySelector('[data-k="total"]').textContent = rub(c.total);
      var full = card.querySelector('[data-k="full"]');
      if (full) full.textContent = rub(c.full);
      card.querySelector('[data-k="lesson"]').textContent = 'Индивидуальные уроки по ' + state.dur + ' минут';
    });
    tweenNumber(onePriceEl, lessonPrice(state.lang, state.format, state.dur));
  }

  buildPricing();

  document.querySelectorAll('input[name="p-format"]').forEach(function (input) {
    input.addEventListener('change', function () { state.format = input.value; renderPrices(); });
  });
  document.querySelectorAll('input[name="p-dur"]').forEach(function (input) {
    input.addEventListener('change', function () { state.dur = Number(input.value); renderPrices(); });
  });

  /* ---------- Запись через Telegram ---------- */

  var signupName = document.getElementById('signup-name');
  var signupMsg = document.getElementById('signup-message');
  var signupTg = document.getElementById('signup-tg');
  var packChip = document.getElementById('signup-pack');
  var packText = document.getElementById('signup-pack-text');

  function checked(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  function updateSignup() {
    var subj = (document.querySelector('[data-i18n="subjGen"]') || {}).textContent || 'английского';
    var name = signupName.value.trim().replace(/\s+/g, ' ');
    var who = checked('who') === 'kid' ? 'ребёнок' : 'взрослый';
    var fmt = checked('fmt') === 'offline' ? 'лично, с выездом' : 'онлайн';
    var msg = 'Здравствуйте! ' +
      (name ? 'Меня зовут ' + name + '. ' : '') +
      'Хочу записаться на бесплатный пробный урок ' + subj + '. ' +
      'Кто будет заниматься: ' + who + '. Формат: ' + fmt + '.' +
      (state.pack ? ' Интересует пакет: ' + state.pack.n + ' уроков по ' + state.pack.dur + ' минут.' : '');
    signupMsg.textContent = msg;
    signupTg.href = 'https://t.me/Eligolc?text=' + encodeURIComponent(msg);

    if (state.pack) {
      packText.textContent = 'Пакет: ' + state.pack.n + ' уроков по ' + state.pack.dur + ' минут';
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
    state.pack = null;
    updateSignup();
  });

  pricingEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-pack]');
    if (!btn) return;
    state.pack = { n: Number(btn.dataset.pack), dur: state.dur };
    document.getElementById(state.format === 'offline' ? 'fmt-offline' : 'fmt-online').checked = true;
    updateSignup();
    document.getElementById('zapis').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  });

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

  var form = document.getElementById('trial-form');
  var formBody = form.querySelector('.form__body');
  var stateOk = form.querySelector('.form__state--ok');
  var stateErr = form.querySelector('.form__state--error');
  var submitBtn = form.querySelector('button[type="submit"]');
  var phoneInput = form.elements.phone;

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

    if (name.value.trim().length < 2) { setError(name, 'Напишите, как к вам обращаться'); ok = false; }
    else setError(name, '');

    if (phoneInput.value.replace(/\D/g, '').length < 10) { setError(phoneInput, 'Укажите номер телефона полностью'); ok = false; }
    else setError(phoneInput, '');

    var tgValue = tg.value.trim();
    if (tgValue && !/^(@?[A-Za-z0-9_]{4,32}|\+?[\d\s()-]{10,20})$/.test(tgValue)) {
      setError(tg, 'Ник в формате @username'); ok = false;
    } else setError(tg, '');

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
    formBody.hidden = true;
    stateOk.hidden = el !== stateOk;
    stateErr.hidden = el !== stateErr;
    if (el === stateOk) {
      prepareDraw(stateOk);
      void stateOk.offsetWidth;
      stateOk.classList.add('is-drawn');
    }
    el.focus({ preventScroll: true });
  }

  form.querySelector('[data-form-retry]').addEventListener('click', function () {
    stateErr.hidden = true;
    formBody.hidden = false;
    submitBtn.focus();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.classList.contains('is-sending')) return;
    if (!validate()) {
      var bad = form.querySelector('[aria-invalid="true"]');
      if (bad) bad.focus();
      return;
    }

    var payload = {
      name: form.elements.name.value.trim(),
      phone: phoneInput.value.trim(),
      telegram: form.elements.telegram.value.trim(),
      website: form.elements.website.value,
      lang: state.lang
    };

    form.classList.add('is-sending');
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn__label').textContent = 'Отправляем…';

    var controller = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 12000);

    fetch(new URL('send.php', SITE_ROOT), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) { return res.json().catch(function () { return { ok: false }; }); })
      .then(function (data) {
        if (data && data.ok) { form.reset(); showState(stateOk); }
        else showState(stateErr);
      })
      .catch(function () { showState(stateErr); })
      .then(function () {
        clearTimeout(timer);
        form.classList.remove('is-sending');
        submitBtn.disabled = false;
        submitBtn.querySelector('.btn__label').textContent = 'Записаться';
      });
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

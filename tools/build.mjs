// Сборка сайта для поисковиков: node tools/build.mjs
//
// Что делает:
// 1. Ставит в index.html свежие метки версий для style.css и main.js (чтобы браузеры
//    подхватывали изменения при долгом кэше).
// 2. Вписывает разметку schema.org (организация, курс, вопросы) и, если задан адрес
//    сайта, canonical и картинку для соцсетей.
// 3. Собирает польскую страницу site/pl/index.html из index.html: меняет только то,
//    что отличается (блок PL ниже). Всё остальное общее.
// 4. Пишет robots.txt и, если задан адрес сайта, sitemap.xml.
//
// Запускайте после любой правки index.html. Польскую страницу руками не правьте.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Адрес сайта без слэша в конце, например 'https://eli-english.ru'.
// Пока сайт не выложен, оставьте пустым.
const SITE_URL = '';

// ---------- Что отличается на польской странице ----------

const PL = {
  titleTag: 'Уроки польского языка с репетитором в СПб и онлайн | eli polski',
  description: 'Частные уроки польского языка для детей с 4 лет и взрослых. Онлайн или с выездом к вам в Санкт-Петербурге, рядом с м. Электросила. 13 лет практики. Первый урок бесплатно.',
  ogTitle: 'Польский без границ | eli polski',
  ogDescription: 'Частные уроки польского для детей и взрослых. Онлайн или с выездом в Санкт-Петербурге. Первый урок бесплатно.',
  siteName: 'eli polski',
  // элементы с data-i18n="ключ": простой текст
  text: {
    eyebrow: 'Частные уроки польского',
    subjGen: 'польского',
    logo: 'polski',
    brandCaps: 'eli polski',
    footerNote: 'Частные уроки польского'
  },
  // элементы с data-i18n-html="ключ": текст с разметкой
  html: {
    title: '<span class="line"><span>Польский</span></span> <span class="line"><span><em>без границ</em></span></span>',
    footerSlogan: 'Польский <em>без&nbsp;границ</em>.'
  },
  heroImg: `<img class="hero__img hero__img--pl"
              src="assets/img/teacher-pl-1040.webp"
              srcset="assets/img/teacher-pl-640.webp 640w, assets/img/teacher-pl-1040.webp 1040w"
              sizes="(max-width: 760px) 380px, 560px"
              width="1040" height="1014"
              alt="" fetchpriority="high" decoding="async">`,
  preload: `<link rel="preload" as="image" href="assets/img/teacher-pl-1040.webp" imagesrcset="assets/img/teacher-pl-640.webp 640w, assets/img/teacher-pl-1040.webp 1040w" imagesizes="(max-width: 760px) 380px, 560px" fetchpriority="high">`
};

// Данные для разметки schema.org
const PAGES = {
  en: { path: '/', name: 'eli english', course: 'Частные уроки английского языка', og: 'og-en.jpg', ogAlt: 'eli english: английский раз и навсегда' },
  pl: { path: '/pl/', name: 'eli polski', course: 'Частные уроки польского языка', og: 'og-pl.jpg', ogAlt: 'eli polski: польский без границ' }
};

// ---------- Сборка ----------

const root = fileURLToPath(new URL('../site/', import.meta.url));
const file = (p) => join(root, p);
const read = (p) => readFileSync(file(p), 'utf8');
const hash = (p) => createHash('md5').update(readFileSync(file(p))).digest('hex').slice(0, 8);

function fail(message) {
  console.error('Ошибка сборки: ' + message);
  process.exit(1);
}

function replaceOnce(html, from, to, label) {
  if (!html.includes(from)) fail('не найдено в index.html: ' + label);
  return html.replace(from, to);
}

function replaceBlock(html, name, content) {
  const re = new RegExp('(<!-- ' + name + ':start[^>]*-->)[\\s\\S]*?(<!-- ' + name + ':end -->)');
  if (!re.test(html)) fail('нет меток ' + name + ':start / ' + name + ':end');
  return html.replace(re, (_, a, b) => a + (content ? '\n  ' + content + '\n  ' : '\n  ') + b);
}

// Меняет содержимое элемента с атрибутом attr="key", учитывая вложенные теги того же имени.
function replaceInner(html, attr, key, inner) {
  const open = new RegExp('<(\\w+)[^>]*\\s' + attr + '="' + key + '"[^>]*>', 'g');
  let out = html;
  let m;
  let found = false;
  while ((m = open.exec(out))) {
    found = true;
    const tag = m[1];
    const start = m.index + m[0].length;
    const tagRe = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'g');
    tagRe.lastIndex = start;
    let depth = 1;
    let t;
    while ((t = tagRe.exec(out))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) break;
    }
    if (!t) fail('не закрыт тег у ' + attr + '="' + key + '"');
    out = out.slice(0, start) + inner + out.slice(t.index);
    open.lastIndex = start + inner.length;
  }
  if (!found) fail('нет элемента ' + attr + '="' + key + '"');
  return out;
}

function decode(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8209;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function faqFromHtml(html) {
  const questions = [...html.matchAll(/class="faq__q"[^>]*>([\s\S]*?)<span class="faq__plus"/g)].map((m) => decode(m[1]));
  const answers = [...html.matchAll(/class="faq__a"[^>]*><div><p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1]));
  if (!questions.length || questions.length !== answers.length) fail('не удалось прочитать вопросы и ответы');
  return questions.map((q, i) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: answers[i] } }));
}

function pricesFromScript() {
  const js = read('assets/js/main.js');
  const base = js.match(/var BASE = (\{[^;]+\});/);
  const extra = js.match(/var OFFLINE_EXTRA = (\d+);/);
  if (!base || !extra) fail('не найдены цены в main.js');
  const BASE = Function('return ' + base[1])();
  const maxOff = Math.max(...[...js.matchAll(/off: (\d+)/g)].map((m) => Number(m[1])));
  const range = (lang) => ({
    low: Math.floor(BASE[lang][60] * (100 - maxOff) / 100 / 10) * 10,
    high: BASE[lang][90] + Number(extra[1])
  });
  return { en: range('en'), pl: range('pl') };
}

function schema(lang, html, description, prices) {
  const page = PAGES[lang];
  const url = SITE_URL ? SITE_URL + page.path : undefined;
  const id = (url || '') + '#org';
  const org = {
    '@type': 'EducationalOrganization',
    '@id': id,
    name: page.name,
    description,
    telephone: '+7 977 748-07-96',
    sameAs: ['https://t.me/Eligolc'],
    address: { '@type': 'PostalAddress', addressLocality: 'Санкт-Петербург', addressRegion: 'Санкт-Петербург', addressCountry: 'RU' },
    areaServed: { '@type': 'City', name: 'Санкт-Петербург' },
    priceRange: prices.low + '-' + prices.high + ' RUB'
  };
  if (url) {
    org.url = url;
    org.image = SITE_URL + '/' + page.og;
  }
  const course = {
    '@type': 'Course',
    name: page.course,
    description,
    inLanguage: 'ru',
    provider: { '@id': id },
    offers: { '@type': 'AggregateOffer', priceCurrency: 'RUB', lowPrice: String(prices.low), highPrice: String(prices.high), offerCount: '16' },
    hasCourseInstance: [
      { '@type': 'CourseInstance', courseMode: 'Online' },
      { '@type': 'CourseInstance', courseMode: 'Onsite', location: { '@type': 'Place', name: 'Санкт-Петербург, рядом с м. Электросила' } }
    ]
  };
  const faq = { '@type': 'FAQPage', mainEntity: faqFromHtml(html) };
  const data = { '@context': 'https://schema.org', '@graph': [org, course, faq] };
  return '<script type="application/ld+json">\n' + JSON.stringify(data, null, 2) + '\n  </script>';
}

function seoTags(lang) {
  if (!SITE_URL) return '';
  const page = PAGES[lang];
  const url = SITE_URL + page.path;
  const img = SITE_URL + '/' + page.og;
  return [
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${page.ogAlt}">`,
    `<meta name="twitter:image" content="${img}">`
  ].join('\n  ');
}

function metaContent(html, attr, name, value) {
  const re = new RegExp('(<meta ' + attr + '="' + name + '" content=")[^"]*(")');
  if (!re.test(html)) fail('нет тега meta ' + name);
  return html.replace(re, (_, a, b) => a + value + b);
}

// пути к файлам на польской странице лежат на уровень выше
function prefixPaths(html) {
  const isRelative = (u) => u && !/^(https?:|\/\/|\/|#|tel:|mailto:|data:|\.\.\/|__)/.test(u);
  const fix = (u) => (isRelative(u) ? '../' + u : u);
  return html.replace(/\s(src|href|srcset|imagesrcset)="([^"]*)"/g, (all, attr, value) => {
    if (attr === 'srcset' || attr === 'imagesrcset') {
      return ` ${attr}="${value.split(',').map((part) => {
        const [u, ...rest] = part.trim().split(/\s+/);
        return [fix(u), ...rest].join(' ');
      }).join(', ')}"`;
    }
    return ` ${attr}="${fix(value)}"`;
  });
}

// ---------- 1-2. Английская страница ----------

let en = read('index.html');
const prices = pricesFromScript();
const cssV = hash('assets/css/style.css');
const jsV = hash('assets/js/main.js');

en = en.replace(/assets\/css\/style\.css\?v=[^"]*/, 'assets/css/style.css?v=' + cssV);
en = en.replace(/assets\/js\/main\.js\?v=[^"]*/, 'assets/js/main.js?v=' + jsV);
const enDescription = (en.match(/<meta name="description" content="([^"]*)"/) || [])[1];
if (!enDescription) fail('нет meta description');
en = replaceBlock(en, 'seo', seoTags('en'));
en = replaceBlock(en, 'schema', schema('en', en, enDescription, prices.en));
writeFileSync(file('index.html'), en);

// ---------- 3. Польская страница ----------

let pl = en;
pl = replaceOnce(pl, '<html lang="ru" data-lang="en">', '<html lang="ru" data-lang="pl">', 'тег html');
pl = pl.replace(/<title>[^<]*<\/title>/, `<title>${PL.titleTag}</title>`);
pl = metaContent(pl, 'name', 'description', PL.description);
pl = metaContent(pl, 'property', 'og:title', PL.ogTitle);
pl = metaContent(pl, 'property', 'og:description', PL.ogDescription);
pl = metaContent(pl, 'property', 'og:site_name', PL.siteName);
pl = replaceBlock(pl, 'seo', seoTags('pl'));
pl = replaceBlock(pl, 'preload', PL.preload);
pl = replaceBlock(pl, 'schema', schema('pl', en, PL.description, prices.pl));
pl = replaceBlock(pl, 'hero-img', PL.heroImg);
for (const [key, value] of Object.entries(PL.text)) pl = replaceInner(pl, 'data-i18n', key, value);
for (const [key, value] of Object.entries(PL.html)) pl = replaceInner(pl, 'data-i18n-html', key, value);
pl = replaceOnce(pl, 'href="./" data-lang-link="en" aria-current="page"', 'href="__EN__" data-lang-link="en"', 'ссылка «Английский»');
pl = replaceOnce(pl, 'href="pl/" data-lang-link="pl"', 'href="__PL__" data-lang-link="pl" aria-current="page"', 'ссылка «Польский»');
pl = prefixPaths(pl);
pl = pl.replace('href="__EN__"', 'href="../"').replace('href="__PL__"', 'href="./"');
pl = pl.replace('<!doctype html>', '<!doctype html>\n<!-- Собрано командой node tools/build.mjs из index.html. Не правьте этот файл вручную. -->');

mkdirSync(file('pl'), { recursive: true });
writeFileSync(file('pl/index.html'), pl);

// ---------- 4. robots.txt и sitemap.xml ----------

const robots = [
  'User-agent: *',
  'Disallow: /send.php',
  'Disallow: /config.example.php',
  SITE_URL ? '\nSitemap: ' + SITE_URL + '/sitemap.xml' : ''
].join('\n').trim() + '\n';
writeFileSync(file('robots.txt'), robots);

if (SITE_URL) {
  const today = new Date().toISOString().slice(0, 10);
  const url = (path, priority) => `  <url>\n    <loc>${SITE_URL}${path}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>\n  </url>`;
  writeFileSync(file('sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${url('/', '1.0')}\n${url('/pl/', '0.9')}\n</urlset>\n`);
} else if (existsSync(file('sitemap.xml'))) {
  rmSync(file('sitemap.xml'));
}

console.log('Готово.');
console.log('  index.html: версии style.css=' + cssV + ', main.js=' + jsV);
console.log('  pl/index.html: собрана');
console.log('  robots.txt: записан' + (SITE_URL ? ', sitemap.xml: записан' : ''));
if (!SITE_URL) console.log('  Адрес сайта не задан (SITE_URL в tools/build.mjs): canonical, картинки для соцсетей и sitemap появятся после выкладки.');

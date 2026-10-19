// Проверка перед релизом: поисковики, скорость, тексты. Запуск после node tools/build.mjs:
//   node tools/seo-check.mjs
// «ОШИБКА» нужно исправить до выкладки, «совет» можно оставить.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SITE_URL, VERIFY, METRIKA_ID } from './site.config.mjs';

const root = fileURLToPath(new URL('../site/', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const kb = (p) => Math.round(statSync(join(root, p)).size / 1024);
let errors = 0;
let tips = 0;
const ok = (text) => console.log('  ок      ' + text);
const bad = (text) => { errors++; console.log('  ОШИБКА  ' + text); };
const tip = (text) => { tips++; console.log('  совет   ' + text); };
const check = (cond, good, problem, soft) => (cond ? ok(good) : soft ? tip(problem) : bad(problem));
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

// Фразы, которые владелец просил убрать с сайта (19.10.2026). Если вернутся, проверка скажет.
const BANNED = ['Электросил', 'Московск', 'видеосвяз', 'Чем больше пакет', 'Дальше занимаемся', 'рефер', 'Код приглашения'];

function page(path, keyword, url) {
  console.log('\n' + path);
  const html = read(path);
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  check(title.length >= 30 && title.length <= 65, `title ${title.length} символов`, `title ${title.length} символов (лучше 30–65): ${title}`);
  check(desc.length >= 70 && desc.length <= 160, `description ${desc.length} символов`, `description ${desc.length} символов (лучше 70–160)`);
  check(new RegExp(keyword, 'i').test(title) && new RegExp(keyword, 'i').test(desc), `«${keyword}» есть в title и description`, `«${keyword}» нет в title или description`);
  check(/<html lang="ru"/.test(html), 'язык страницы ru', 'нет lang="ru"');
  check(/name="viewport"/.test(html), 'есть viewport для телефонов', 'нет meta viewport');
  check(!/content="noindex/.test(html), 'страница открыта для поисковиков', 'стоит noindex');
  const h1 = html.match(/<h1[\s>]/g) || [];
  check(h1.length === 1, 'один заголовок h1', `заголовков h1: ${h1.length}`);
  const h1text = text((html.match(/<h1[\s\S]*?<\/h1>/) || [''])[0]);
  check(new RegExp(keyword, 'i').test(h1text), `в h1 есть «${keyword}»`, `в h1 нет «${keyword}»`);

  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  check(imgs.every((i) => /\salt="/.test(i)), 'у всех картинок есть alt', 'есть картинки без alt');
  check(imgs.every((i) => /\swidth="/.test(i) && /\sheight="/.test(i)), 'у картинок заданы размеры (страница не прыгает)', 'есть картинки без width/height');
  const hero = imgs.find((i) => /hero__img/.test(i)) || '';
  check(/alt="[^"]+"/.test(hero), 'фото преподавателя подписано (видно в поиске по картинкам)', 'у фото преподавателя пустой alt', true);

  check(!html.includes('&#8209;'), 'нет неразрывных дефисов (поисковик видит «Санкт-Петербург» как обычно)', 'есть &#8209;: поисковик может не узнать слово');
  const words = text(html);
  const found = BANNED.filter((w) => words.toLowerCase().includes(w.toLowerCase()));
  check(!found.length, 'убранные фразы не вернулись', 'на странице снова есть: ' + found.join(', '));
  check(/Санкт-Петербург/.test(words), 'город «Санкт-Петербург» есть в тексте', 'в тексте нет «Санкт-Петербург»');

  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const broken = anchors.filter((a) => !ids.has(a));
  check(!broken.length, 'все ссылки внутри страницы ведут на свои блоки', 'битые якоря: ' + broken.join(', '));
  check(!/(src|href)="http:\/\//.test(html), 'нет ссылок по http (только https)', 'есть ссылки по http://');

  const ld = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
  let data = null;
  try { data = JSON.parse(ld); } catch {}
  check(data, 'разметка schema.org читается', 'разметка schema.org сломана');
  if (data) {
    const types = data['@graph'].map((n) => n['@type']);
    check(['EducationalOrganization', 'Course', 'FAQPage'].every((t) => types.includes(t)), 'schema.org: организация, курс, вопросы', 'schema.org: не хватает типов, есть ' + types.join(', '));
    const faq = data['@graph'].find((n) => n['@type'] === 'FAQPage');
    const visible = (html.match(/class="faq__item"/g) || []).length;
    check(faq && faq.mainEntity.length === visible, `вопросы в разметке совпадают с сайтом (${visible})`, 'вопросы в разметке и на сайте разные: запустите build.mjs');
  }

  if (url) {
    check(html.includes(`<link rel="canonical" href="${url}">`), 'canonical: ' + url, 'нет canonical или он другой');
    check(/property="og:image" content="https:/.test(html), 'картинка для мессенджеров', 'нет og:image');
  } else {
    tip('canonical и og:image появятся, когда в site.config.mjs будет SITE_URL');
  }
  return html;
}

console.log('Проверка сайта перед релизом');
const en = page('index.html', 'английск', SITE_URL ? SITE_URL + '/' : '');
page('pl/index.html', 'польск', SITE_URL ? SITE_URL + '/pl/' : '');

console.log('\nДля поисковиков');
const robots = read('robots.txt');
check(/Allow: \//.test(robots) && !/Disallow: \/\s*$/m.test(robots), 'robots.txt открывает сайт', 'robots.txt закрывает сайт');
if (SITE_URL) {
  check(robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`), 'в robots.txt есть sitemap', 'в robots.txt нет sitemap');
  check(existsSync(join(root, 'sitemap.xml')), 'sitemap.xml есть', 'нет sitemap.xml: запустите build.mjs');
  check(VERIFY.yandex, 'код Яндекс Вебмастера вписан', 'нет кода Яндекс Вебмастера (site.config.mjs → VERIFY.yandex)', true);
  check(VERIFY.google, 'код Google Search Console вписан', 'нет кода Google Search Console (site.config.mjs → VERIFY.google)', true);
  check(METRIKA_ID, 'Яндекс Метрика подключена', 'нет Яндекс Метрики (нужна для рекламы)', true);
} else {
  tip('сайт ещё не на своём адресе: sitemap, коды поисковиков и Метрика включатся после SITE_URL');
}
check(existsSync(join(root, '404.html')), 'страница 404 есть', 'нет 404.html');
check(/max-age=31536000/.test(read('.htaccess')) && /RewriteRule \^ https:/.test(read('.htaccess')), '.htaccess: HTTPS, HSTS, без www', '.htaccess без HTTPS-правил');

console.log('\nСкорость');
check(!/fonts\.googleapis|fonts\.gstatic/.test(en), 'шрифты свои, без запросов к Google', 'шрифты грузятся с Google');
check(/rel="preload" as="image"/.test(en), 'фото первого экрана грузится первым', 'нет preload для фото первого экрана');
const css = kb('assets/css/style.css');
const js = kb('assets/js/main.js');
check(css <= 60, `style.css ${css} КБ`, `style.css ${css} КБ: многовато`, true);
check(js <= 40, `main.js ${js} КБ`, `main.js ${js} КБ: многовато`, true);
const heroImg = (en.match(/<img class="hero__img[^>]*src="([^"]+)"/) || [])[1];
if (heroImg) {
  const size = kb(heroImg);
  check(size <= 200, `фото первого экрана ${size} КБ`, `фото первого экрана ${size} КБ: лучше до 200`, true);
}
check(/\?v=[0-9a-f]{8}/.test(en), 'у css и js метки версий (обновления видны сразу)', 'нет меток версий: запустите build.mjs');

console.log(`\nИтог: ошибок ${errors}, советов ${tips}`);
process.exit(errors ? 1 : 0);

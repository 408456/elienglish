// Сообщает Яндексу и Bing (через IndexNow), что страницы сайта обновились:
//   node tools/indexnow.mjs
// Запускается сам после каждой выкладки на хостинг (.github/workflows/deploy.yml).
// Google IndexNow не поддерживает: для него есть sitemap.xml и Search Console.
import { SITE_URL, INDEXNOW_KEY } from './site.config.mjs';

if (!SITE_URL || !/^[0-9a-f]{32}$/.test(INDEXNOW_KEY)) {
  console.log('IndexNow: адрес сайта или ключ не заданы в tools/site.config.mjs, пропускаю.');
  process.exit(0);
}

const body = {
  host: new URL(SITE_URL).host,
  key: INDEXNOW_KEY,
  keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
  urlList: [`${SITE_URL}/`, `${SITE_URL}/pl/`],
};

for (const endpoint of ['https://yandex.com/indexnow', 'https://api.indexnow.org/indexnow']) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    console.log(`IndexNow ${new URL(endpoint).host}: ${res.status}`);
  } catch (err) {
    console.log(`IndexNow ${new URL(endpoint).host}: не ответил (${err.message})`);
  }
}

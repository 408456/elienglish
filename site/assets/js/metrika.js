/* Яндекс Метрика. Подключается сборкой, только если в tools/site.config.mjs задан METRIKA_ID.
   Номер счётчика берётся из атрибута data-metrika у этого скрипта. */
(function () {
  'use strict';
  var me = document.currentScript || document.querySelector('script[data-metrika]');
  var id = me ? Number(me.dataset.metrika) : 0;
  if (!id) return;
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = Date.now();
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.appendChild(s);
  window.ym(id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true });
})();

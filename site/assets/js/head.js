// Выполняется до отрисовки страницы: включает анимации появления
// и переводит старые ссылки вида ?lang=pl на польскую страницу.
document.documentElement.classList.add('js');
if (/[?&]lang=pl(&|$)/.test(location.search) && document.documentElement.dataset.lang !== 'pl') {
  location.replace('pl/' + location.hash);
}

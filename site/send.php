<?php
// Принимает заявку с сайта и пересылает её боту в Telegram.
//
// Защита:
// - только POST, только JSON, только со своего сайта (заголовок Origin);
// - размер запроса не больше 4 КБ;
// - ловушки для спам-ботов: скрытое поле и слишком быстрое заполнение;
// - лимиты: не больше 5 заявок с одного адреса за 10 минут и 60 заявок в час всего;
// - строгая проверка полей, управляющие символы и ссылки отсекаются;
// - заявка уходит в бот заявок (папка bot рядом с сайтом), токен лежит там же, вне сайта;
// - ошибки не показываются посетителю, только пишутся в журнал хостинга.
declare(strict_types=1);

ini_set('display_errors', '0');
header_remove('X-Powered-By');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');

const MAX_BODY = 4096;
const MIN_FILL_MS = 3000;
const LIMIT_PER_IP = 5;
const LIMIT_PER_IP_WINDOW = 600;
const LIMIT_TOTAL = 60;
const LIMIT_TOTAL_WINDOW = 3600;

function reply(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function str_cut(string $value, int $max): string
{
    return function_exists('mb_substr') ? mb_substr($value, 0, $max, 'UTF-8') : substr($value, 0, $max);
}

function str_len(string $value): int
{
    return function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
}

// Убирает теги, управляющие и невидимые символы, лишние пробелы.
function clean($value, int $max): string
{
    if (!is_string($value)) {
        return '';
    }
    if (!preg_match('//u', $value)) {
        return ''; // не UTF-8
    }
    $value = strip_tags($value);
    $value = preg_replace('/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/u', ' ', $value) ?? '';
    $value = preg_replace('/\s+/u', ' ', $value) ?? '';
    return str_cut(trim($value), $max);
}

// Папка для лимитов: вне сайта, если можно, иначе во временной папке сервера.
function storage_dir(): ?string
{
    foreach ([dirname(__DIR__) . '/.eli-data', sys_get_temp_dir() . '/eli-data'] as $dir) {
        if (is_dir($dir) || @mkdir($dir, 0700, true)) {
            if (is_writable($dir)) {
                return $dir;
            }
        }
    }
    return null;
}

// Возвращает false, если лимит превышен. Если хранилище недоступно, не мешает людям.
function within_limits(string $ip): bool
{
    $dir = storage_dir();
    if ($dir === null) {
        error_log('eli send.php: нет папки для лимитов');
        return true;
    }
    $fh = @fopen($dir . '/limits.json', 'c+');
    if ($fh === false || !flock($fh, LOCK_EX)) {
        return true;
    }
    $now = time();
    $data = json_decode(stream_get_contents($fh) ?: '', true);
    if (!is_array($data)) {
        $data = ['ips' => [], 'all' => []];
    }
    $key = hash('sha256', $ip . '|' . __DIR__);
    $all = array_values(array_filter((array) ($data['all'] ?? []), fn($t) => is_int($t) && $t > $now - LIMIT_TOTAL_WINDOW));
    $ips = [];
    foreach ((array) ($data['ips'] ?? []) as $k => $times) {
        $times = array_values(array_filter((array) $times, fn($t) => is_int($t) && $t > $now - LIMIT_PER_IP_WINDOW));
        if ($times) {
            $ips[$k] = $times;
        }
    }
    $mine = $ips[$key] ?? [];
    $ok = count($mine) < LIMIT_PER_IP && count($all) < LIMIT_TOTAL;
    if ($ok) {
        $mine[] = $now;
        $all[] = $now;
        $ips[$key] = $mine;
    }
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode(['ips' => $ips, 'all' => $all]));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $ok;
}

// ---------- Проверки запроса ----------

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    reply(405, ['ok' => false]);
}

// Только со своего сайта: браузер всегда присылает Origin в POST-запросе.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$host = strtolower(preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? '') ?? '');
if ($origin !== '' && strtolower((string) parse_url($origin, PHP_URL_HOST)) !== $host) {
    reply(403, ['ok' => false]);
}

if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    reply(415, ['ok' => false]);
}

if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_BODY) {
    reply(413, ['ok' => false]);
}
$raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ($raw === false || strlen($raw) > MAX_BODY) {
    reply(413, ['ok' => false]);
}

$data = json_decode($raw, true, 4);
if (!is_array($data)) {
    reply(400, ['ok' => false]);
}

// Ловушки для ботов: делаем вид, что всё прошло, но ничего не отправляем.
if (!empty($data['website'])) {
    reply(200, ['ok' => true]);
}
$elapsed = $data['elapsed'] ?? null;
if (!is_int($elapsed) || $elapsed < MIN_FILL_MS) {
    reply(200, ['ok' => true]);
}

// ---------- Поля ----------

$name     = clean($data['name'] ?? '', 60);
$phone    = clean($data['phone'] ?? '', 25);
$telegram = clean($data['telegram'] ?? '', 40);
$lang     = ($data['lang'] ?? '') === 'pl' ? 'pl' : 'en';

$errors = [];
if (str_len($name) < 2 || !preg_match('/^[\p{L}\p{M}][\p{L}\p{M} .\'-]*$/u', $name)) {
    $errors[] = 'name';
}
if (!preg_match('/^\+?[\d\s()-]{10,25}$/', $phone) || preg_match_all('/\d/', $phone) < 10 || preg_match_all('/\d/', $phone) > 15) {
    $errors[] = 'phone';
}
if ($telegram !== '' && !preg_match('/^(@?[A-Za-z0-9_]{4,32}|\+?[\d\s()-]{10,20})$/', $telegram)) {
    $errors[] = 'telegram';
}
if ($errors) {
    reply(422, ['ok' => false, 'error' => 'fields', 'fields' => $errors]);
}

// ---------- Лимиты ----------

if (!within_limits($_SERVER['REMOTE_ADDR'] ?? 'unknown')) {
    header('Retry-After: 600');
    reply(429, ['ok' => false, 'error' => 'too_many']);
}

// ---------- Отправка в бот заявок ----------
// Код бота лежит в папке bot рядом с папкой сайта. Бот сохраняет заявку
// и присылает её всем админам с кнопками.

$lib = dirname(__DIR__) . '/bot/lib.php';
if (!is_file($lib)) {
    error_log('eli send.php: нет папки bot рядом с сайтом');
    reply(503, ['ok' => false, 'error' => 'not_configured']);
}
define('ELI_WEB', true);
require $lib;
if ((string) cfg()['token'] === '') {
    error_log('eli send.php: в bot/config.php нет токена');
    reply(503, ['ok' => false, 'error' => 'not_configured']);
}

$tgUser = preg_match('/^@?([A-Za-z0-9_]{4,32})$/', $telegram, $m) ? $m[1] : '';
try {
    $token = site_form_lead(['name' => $name, 'phone' => $phone, 'tg' => $tgUser, 'lang' => $lang]);
} catch (Throwable $e) {
    error_log('eli send.php: ' . $e->getMessage());
    reply(502, ['ok' => false]);
}

// token: по ссылке t.me/бот?start=T<token> ученик откроет бота, и ему можно будет ответить
reply(200, ['ok' => true, 'bot' => (string) cfg()['bot_username'], 'token' => $token]);

<?php
// Принимает заявку с сайта и пересылает её боту в Telegram.
//
// Защита:
// - только POST, только JSON, только со своего сайта (заголовок Origin);
// - размер запроса не больше 4 КБ;
// - ловушки для спам-ботов: скрытое поле и слишком быстрое заполнение;
// - лимиты: не больше 5 заявок с одного адреса за 10 минут и 60 заявок в час всего;
// - строгая проверка полей, управляющие символы и ссылки отсекаются;
// - токен бота хранится вне сайта (eli-config.php уровнем выше) или в config.php,
//   который закрыт от браузера в .htaccess;
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

function load_config(): array
{
    foreach ([dirname(__DIR__) . '/eli-config.php', __DIR__ . '/config.php'] as $file) {
        if (is_file($file)) {
            $config = require $file;
            if (is_array($config)) {
                return $config;
            }
        }
    }
    return [];
}

function send_telegram(string $token, string $chatId, string $text): bool
{
    $url = 'https://api.telegram.org/bot' . $token . '/sendMessage';
    $body = http_build_query(['chat_id' => $chatId, 'text' => $text, 'disable_web_page_preview' => 'true']);

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $result = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return $result !== false && $status === 200;
    }

    $context = stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content'       => $body,
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]);
    $result = @file_get_contents($url, false, $context);
    return $result !== false && strpos($http_response_header[0] ?? '', ' 200') !== false;
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
$subject  = ($data['lang'] ?? '') === 'pl' ? 'польский' : 'английский';

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

// ---------- Отправка ----------

$config = load_config();
$token = (string) ($config['bot_token'] ?? '');
$chatId = (string) ($config['chat_id'] ?? '');
if ($token === '' || $chatId === '' || !preg_match('/^\d+:[\w-]{30,}$/', $token)) {
    error_log('eli send.php: бот не настроен');
    reply(503, ['ok' => false, 'error' => 'not_configured']);
}

date_default_timezone_set('Europe/Moscow');
$text = "Новая заявка на бесплатный урок\n\n"
      . "Язык: {$subject}\n"
      . "Имя: {$name}\n"
      . "Телефон: {$phone}"
      . ($telegram !== '' ? "\nTelegram: {$telegram}" : '')
      . "\n\n" . date('d.m.Y H:i') . ' (МСК)';

if (!send_telegram($token, $chatId, $text)) {
    error_log('eli send.php: Telegram не принял сообщение');
    reply(502, ['ok' => false]);
}

reply(200, ['ok' => true]);

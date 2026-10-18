<?php
// Приём сообщений бота заявок на хостинге. Telegram присылает сюда каждое событие.
// Код бота лежит в папке bot рядом с папкой сайта (не внутри неё).
// Включение: php bot/setup.php webhook https://ваш-сайт.ru/tg-webhook.php
declare(strict_types=1);

ini_set('display_errors', '0');
header_remove('X-Powered-By');
header('Content-Type: text/plain; charset=utf-8');
header('X-Robots-Tag: noindex');

$lib = dirname(__DIR__) . '/bot/lib.php';
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !is_file($lib)) {
    http_response_code(404);
    exit;
}

define('ELI_WEB', true);
require $lib;

// Telegram подписывает каждый запрос секретом из bot/config.php. Без него ничего не делаем.
$secret = (string) cfg()['webhook_secret'];
$given = (string) ($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? '');
if ($secret === '' || !hash_equals($secret, $given)) {
    http_response_code(403);
    exit;
}

if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 1_000_000) {
    http_response_code(413);
    exit;
}
$update = json_decode((string) file_get_contents('php://input', false, null, 0, 1_000_001), true);
if (!is_array($update)) {
    http_response_code(400);
    exit;
}

try {
    handle_update($update);
} catch (Throwable $e) {
    log_error('webhook: ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine());
}
http_response_code(200);
echo 'ok';

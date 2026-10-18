<?php
// Запуск бота на этом компьютере: php bot/poll.php (или двойной клик по bot/start.cmd).
// Пока окно открыто, бот работает. Сообщения, пришедшие, пока бот выключен,
// Telegram хранит сутки и отдаст при следующем запуске.
declare(strict_types=1);

require __DIR__ . '/lib.php';

if (PHP_SAPI !== 'cli') {
    exit;
}

$cfg = cfg();
if ($cfg['token'] === '') {
    fwrite(STDERR, "Нет токена: заполните bot/config.php (образец: bot/config.example.php)\n");
    exit(1);
}

$me = tg('getMe');
if (!$me) {
    fwrite(STDERR, "Telegram не отвечает или токен неверный. Проверьте интернет и bot/config.php\n");
    exit(1);
}
$hook = tg('getWebhookInfo');
if (!empty($hook['result']['url'])) {
    fwrite(STDERR, "У бота включён приём через хостинг (webhook). Пока он включён, запуск на компьютере не нужен.\n"
        . "Чтобы всё-таки запустить здесь: php bot/setup.php nowebhook\n");
    exit(1);
}

echo 'Бот @' . $me['result']['username'] . " запущен. Не закрывайте это окно.\n";
$db = with_db(fn(array &$db) => $db);
if (!$db['owner_claimed'] && $cfg['owner_code'] !== '') {
    echo "\nСтать владельцем бота (ссылка одноразовая, никому не пересылайте):\n";
    echo 'https://t.me/' . $me['result']['username'] . '?start=own_' . $cfg['owner_code'] . "\n\n";
}

$offset = 0;
while (true) {
    $res = tg('getUpdates', ['offset' => $offset, 'timeout' => 50, 'allowed_updates' => ['message', 'callback_query', 'my_chat_member']], 70);
    if ($res === null) {
        sleep(5); // нет связи: подождать и попробовать снова
        continue;
    }
    foreach ($res['result'] as $update) {
        $offset = (int) $update['update_id'] + 1;
        try {
            handle_update($update);
        } catch (Throwable $e) {
            log_error('update ' . $update['update_id'] . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine());
        }
    }
}

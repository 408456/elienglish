<?php
// Настройка бота из командной строки:
//   php bot/setup.php check                проверить токен, админов, заявки
//   php bot/setup.php profile              описание и команды бота в Telegram
//   php bot/setup.php owner                одноразовая ссылка, чтобы стать владельцем
//   php bot/setup.php webhook https://сайт.ru/tg-webhook.php   включить приём на хостинге
//   php bot/setup.php nowebhook            выключить приём на хостинге (для запуска на компьютере)
declare(strict_types=1);

require __DIR__ . '/lib.php';

if (PHP_SAPI !== 'cli') {
    exit;
}

$cmd = $argv[1] ?? 'check';
$me = tg('getMe');
if (!$me) {
    fwrite(STDERR, "Telegram не отвечает или токен неверный (bot/config.php).\n");
    exit(1);
}
$bot = $me['result']['username'];

switch ($cmd) {
    case 'check':
        $db = with_db(fn(array &$db) => $db);
        $hook = tg('getWebhookInfo')['result'] ?? [];
        echo "Бот: @{$bot}\n";
        echo 'Админов: ' . count($db['admins']) . ($db['owner_claimed'] ? '' : ' (владелец ещё не назначен: php bot/setup.php owner)') . "\n";
        echo 'Ждут входа: ' . implode(', ', array_map(fn($u) => '@' . $u, array_merge((array) cfg()['admin_usernames'], $db['pending_admins']))) . "\n";
        echo 'Заявок: ' . count($db['leads']) . "\n";
        echo 'Приём: ' . (!empty($hook['url']) ? 'через хостинг (' . $hook['url'] . ')' : 'на компьютере (php bot/poll.php)') . "\n";
        if (!empty($hook['last_error_message'])) {
            echo 'Последняя ошибка хостинга: ' . $hook['last_error_message'] . "\n";
        }
        break;

    case 'profile':
        tg('setMyCommands', ['commands' => [
            ['command' => 'start', 'description' => 'Начать'],
            ['command' => 'help', 'description' => 'Помощь'],
        ]]);
        tg('setMyShortDescription', ['short_description' => 'Запись на бесплатный пробный урок английского и польского. eli english, Санкт-Петербург и онлайн.']);
        tg('setMyDescription', ['description' => "Бот записи eli english: частные уроки английского и польского для детей и взрослых, онлайн и в Санкт-Петербурге.\n\nНажмите «Старт», и мы ответим вам здесь."]);
        echo "Описание и команды обновлены.\n";
        break;

    case 'owner':
        $db = with_db(fn(array &$db) => $db);
        if ($db['owner_claimed']) {
            echo "Владелец уже назначен. Новых админов добавляет он в меню «Админы».\n";
            break;
        }
        echo "Откройте ссылку в Telegram и нажмите «Старт» (одноразовая, никому не пересылайте):\n";
        echo "https://t.me/{$bot}?start=own_" . cfg()['owner_code'] . "\n";
        break;

    case 'webhook':
        $url = $argv[2] ?? '';
        if (!preg_match('#^https://[^\s]+/tg-webhook\.php$#', $url)) {
            fwrite(STDERR, "Нужен адрес вида https://ваш-сайт.ru/tg-webhook.php (только https)\n");
            exit(1);
        }
        $ok = tg('setWebhook', [
            'url' => $url,
            'secret_token' => cfg()['webhook_secret'],
            'allowed_updates' => ['message', 'callback_query', 'my_chat_member'],
            'max_connections' => 5,
        ]);
        echo $ok ? "Готово: Telegram присылает сообщения на {$url}\n" : "Не получилось, см. bot/data/bot.log\n";
        break;

    case 'nowebhook':
        echo tg('deleteWebhook') ? "Приём через хостинг выключен. Теперь можно запускать php bot/poll.php\n" : "Не получилось\n";
        break;

    default:
        fwrite(STDERR, "Неизвестная команда. Варианты: check, profile, owner, webhook <адрес>, nowebhook\n");
        exit(1);
}

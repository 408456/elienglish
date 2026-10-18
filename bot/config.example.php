<?php
// Образец настроек бота. Скопируйте в bot/config.php и заполните.
// bot/config.php в git не попадает: там токен.
return [
    // токен от @BotFather
    'token' => '',
    'bot_username' => 'elienglish_requests_bot',

    // кто станет админом, когда откроет бота (без @, маленькими буквами)
    'admin_usernames' => ['eligolc'],

    // секрет для одноразовой ссылки владельца: длинная случайная строка из букв и цифр
    'owner_code' => '',

    // секрет, которым Telegram подписывает запросы на хостинг: длинная случайная строка
    'webhook_secret' => '',

    'phone' => '+7 977 748-07-96',
    'timezone' => 'Europe/Moscow',
];

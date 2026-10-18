<?php
// eli english: бот заявок @elienglish_requests_bot.
// Общая логика. Работает двумя способами:
// - на компьютере: php bot/poll.php (бот сам спрашивает Telegram о новых сообщениях);
// - на хостинге: site/tg-webhook.php (Telegram сам присылает сообщения на сайт).
//
// Кто есть кто:
// - ученик: любой, кто пришёл с сайта или написал боту. Видит только свою заявку.
// - админ: видит все заявки, отправляет приветствия и ответы, меняет статусы.
// - владелец: админ, который ещё может добавлять и убирать админов.
declare(strict_types=1);

if (PHP_SAPI !== 'cli' && !defined('ELI_WEB')) {
    http_response_code(404);
    exit;
}

const ELI_STATUSES = ['n' => 'Новая', 'w' => 'В работе', 'b' => 'Записан на урок', 'c' => 'Закрыта'];
const ELI_PAGE = 8;
const ELI_DEFAULT_WELCOME = "Здравствуйте, {имя}! Это eli english. Спасибо за заявку на бесплатный пробный урок {языка}.\n\n"
    . "Подскажите, пожалуйста, в какие дни и в какое время вам удобно? Пробный урок длится 30 минут. Подберём время и пришлём подтверждение.";

// ---------------------------------------------------------------- настройки

function cfg(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $file = __DIR__ . '/config.php';
        $cfg = is_file($file) ? require $file : [];
        if (!is_array($cfg)) {
            $cfg = [];
        }
        $cfg += [
            'token' => '',
            'bot_username' => 'elienglish_requests_bot',
            'admin_usernames' => [],
            'owner_code' => '',
            'webhook_secret' => '',
            'phone' => '+7 977 748-07-96',
            'timezone' => 'Europe/Moscow',
            'data_dir' => __DIR__ . '/data',
        ];
        date_default_timezone_set($cfg['timezone']);
    }
    return $cfg;
}

function data_dir(): string
{
    $dir = defined('ELI_DATA_DIR') ? ELI_DATA_DIR : cfg()['data_dir'];
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
        // на случай, если папку бота по ошибке положат внутрь сайта
        @file_put_contents($dir . '/.htaccess', "Require all denied\n");
    }
    return $dir;
}

function log_error(string $message): void
{
    $file = data_dir() . '/bot.log';
    if (is_file($file) && filesize($file) > 1_000_000) {
        @rename($file, $file . '.old');
    }
    @file_put_contents($file, date('Y-m-d H:i:s') . ' ' . $message . "\n", FILE_APPEND);
}

// ---------------------------------------------------------------- хранилище

function db_default(): array
{
    return [
        'v' => 1,
        'next_lead' => 1,
        'owner_claimed' => false,
        'admins' => [],
        'bound' => [],
        'pending_admins' => [],
        'users' => [],
        'leads' => [],
        'tokens' => [],
        'state' => [],
        'settings' => ['welcome' => ELI_DEFAULT_WELCOME],
        'seen' => [],
    ];
}

// Открывает базу под замком, даёт её изменить и сохраняет. Одно обновление за раз.
function with_db(callable $fn)
{
    $dir = data_dir();
    $lock = fopen($dir . '/db.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        throw new RuntimeException('нет доступа к базе');
    }
    try {
        $file = $dir . '/db.json';
        $db = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        $db = is_array($db) ? $db + db_default() : db_default();
        $result = $fn($db);
        $tmp = $file . '.tmp';
        file_put_contents($tmp, json_encode($db, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        rename($tmp, $file);
        return $result;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

// ---------------------------------------------------------------- Telegram API

function tg(string $method, array $params = [], int $timeout = 15): ?array
{
    $GLOBALS['ELI_TG_ERROR'] = 0;
    if (defined('ELI_TEST')) {
        return eli_test_api($method, $params);
    }
    $token = (string) cfg()['token'];
    if ($token === '') {
        return null;
    }
    $url = 'https://api.telegram.org/bot' . $token . '/' . $method;
    $body = json_encode($params, JSON_UNESCAPED_UNICODE);

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        if (PHP_OS_FAMILY === 'Windows' && defined('CURLSSLOPT_NATIVE_CA')) {
            // на Windows доверяем сертификатам системы (антивирусы подменяют сертификаты HTTPS)
            curl_setopt($ch, CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA);
        }
        $raw = curl_exec($ch);
        if ($raw === false) {
            log_error($method . ': ' . curl_error($ch));
        }
        curl_close($ch);
    } else {
        $raw = @file_get_contents($url, false, stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => $body,
            'timeout' => $timeout,
            'ignore_errors' => true,
        ]]));
    }

    $res = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($res) || empty($res['ok'])) {
        $GLOBALS['ELI_TG_ERROR'] = (int) ($res['error_code'] ?? -1);
        $desc = (string) ($res['description'] ?? 'нет связи с Telegram');
        if (stripos($desc, 'message is not modified') === false) {
            log_error($method . ': ' . $desc);
        }
        return null;
    }
    return ['result' => $res['result']];
}

function send(int $chat, string $text, array $extra = []): ?int
{
    $res = tg('sendMessage', ['chat_id' => $chat, 'text' => $text, 'parse_mode' => 'HTML', 'disable_web_page_preview' => true] + $extra);
    return isset($res['result']['message_id']) ? (int) $res['result']['message_id'] : null;
}

// Текст ученику: без разметки, чтобы ничего из текста не превратилось в ссылки или код.
function send_plain(int $chat, string $text, array $extra = []): ?int
{
    $res = tg('sendMessage', ['chat_id' => $chat, 'text' => $text, 'disable_web_page_preview' => true] + $extra);
    return isset($res['result']['message_id']) ? (int) $res['result']['message_id'] : null;
}

function edit(int $chat, int $messageId, string $text, ?array $markup = null): void
{
    $params = ['chat_id' => $chat, 'message_id' => $messageId, 'text' => $text, 'parse_mode' => 'HTML', 'disable_web_page_preview' => true];
    if ($markup !== null) {
        $params['reply_markup'] = $markup;
    }
    tg('editMessageText', $params);
}

function answer(string $callbackId, string $text = ''): void
{
    tg('answerCallbackQuery', ['callback_query_id' => $callbackId, 'text' => $text]);
}

// ---------------------------------------------------------------- мелочи

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function cut(string $s, int $max): string
{
    return function_exists('mb_substr') ? mb_substr($s, 0, $max, 'UTF-8') : substr($s, 0, $max);
}

// Убирает управляющие и невидимые символы, лишние пробелы (переводы строк оставляет).
function clean_text($value, int $max, bool $multiline = false): string
{
    if (!is_string($value) || !preg_match('//u', $value)) {
        return '';
    }
    $value = preg_replace('/[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}\p{Cf}]+/u', '', $value) ?? '';
    $value = $multiline
        ? (preg_replace("/[ \t]+/u", ' ', $value) ?? '')
        : (preg_replace('/\s+/u', ' ', $value) ?? '');
    return cut(trim($value), $max);
}

function clean_name($value): string
{
    $name = clean_text($value, 40);
    return preg_match('/^[\p{L}\p{M}][\p{L}\p{M} .\'-]*$/u', $name) ? $name : '';
}

function fmt_time(int $ts): string
{
    return date('d.m H:i', $ts);
}

function subject_gen(string $lang): string
{
    return $lang === 'pl' ? 'польского' : 'английского';
}

function admin_name(array $db, int $id): string
{
    return (string) ($db['admins'][$id]['name'] ?? 'админ');
}

function is_admin(array $db, int $id): bool
{
    return isset($db['admins'][$id]);
}

function is_owner(array $db, int $id): bool
{
    return ($db['admins'][$id]['role'] ?? '') === 'owner';
}

function person_name(array $from): string
{
    $name = clean_text(trim(($from['first_name'] ?? '') . ' ' . ($from['last_name'] ?? '')), 40);
    return $name !== '' ? $name : 'без имени';
}

function new_token(): string
{
    return substr(strtr(base64_encode(random_bytes(12)), '+/', 'Az'), 0, 16);
}

// ---------------------------------------------------------------- ссылка с сайта

// Формат (до 64 символов, только A-Z a-z 0-9 _ -):
// 1 + язык(e/p) + кто(a/k/x) + формат(o/l/x) + пакет(0-4) + длительность(6/9)
//   + длина телефона (0-f) + цифры телефона + имя в base64url.
function parse_site_payload(string $p): ?array
{
    if (!preg_match('/^1([ep])([akx])([olx])([0-4])([69])([0-9a-f])([A-Za-z0-9_-]*)$/', $p, $m)) {
        return null;
    }
    $len = hexdec($m[6]);
    $phone = substr($m[7], 0, $len);
    if (strlen($phone) !== $len || !preg_match('/^\d*$/', $phone)) {
        return null;
    }
    $name = '';
    $b64 = substr($m[7], $len);
    if ($b64 !== '') {
        $raw = base64_decode(strtr($b64, '-_', '+/') . str_repeat('=', (4 - strlen($b64) % 4) % 4), true);
        $name = $raw === false ? '' : clean_name($raw);
    }
    return [
        'lang' => $m[1] === 'p' ? 'pl' : 'en',
        'who' => ['a' => 'adult', 'k' => 'kid', 'x' => ''][$m[2]],
        'format' => ['o' => 'online', 'l' => 'offline', 'x' => ''][$m[3]],
        'pack' => [0, 5, 10, 20, 40][(int) $m[4]],
        'dur' => $m[5] === '9' ? 90 : 60,
        'phone' => strlen($phone) >= 10 ? '+' . $phone : '',
        'name' => $name,
    ];
}

// ---------------------------------------------------------------- заявки

function lead_new(array &$db, array $f, string $source): array
{
    $id = (int) $db['next_lead'];
    $db['next_lead'] = $id + 1;
    $lead = [
        'id' => $id,
        'created' => time(),
        'source' => $source,
        'lang' => $f['lang'] ?? 'en',
        'who' => $f['who'] ?? '',
        'format' => $f['format'] ?? '',
        'pack' => (int) ($f['pack'] ?? 0),
        'dur' => (int) ($f['dur'] ?? 60),
        'name' => $f['name'] ?? '',
        'phone' => $f['phone'] ?? '',
        'tg' => $f['tg'] ?? '',
        'user' => $f['user'] ?? 0,
        'status' => 'n',
        'status_by' => 0,
        'status_at' => 0,
        'welcome_at' => 0,
        'welcome_by' => 0,
        'test' => !empty($f['test']),
        'msgs' => [],
    ];
    $db['leads'][$id] = $lead;
    return $lead;
}

function lead_card(array $db, array $l): array
{
    $parts = [];
    $parts[] = $l['lang'] === 'pl' ? 'Польский' : 'Английский';
    if ($l['who'] !== '') {
        $parts[] = $l['who'] === 'kid' ? 'ребёнок' : 'взрослый';
    }
    if ($l['format'] !== '') {
        $parts[] = $l['format'] === 'offline' ? 'лично, с выездом' : 'онлайн';
    }
    $lines = [];
    $lines[] = '<b>Заявка №' . $l['id'] . '</b> · ' . ELI_STATUSES[$l['status']] . ($l['test'] ? ' · <i>тест</i>' : '');
    $lines[] = h(implode(' · ', $parts));
    if ($l['pack']) {
        $lines[] = 'Пакет: ' . $l['pack'] . ' уроков по ' . $l['dur'] . ' минут';
    }
    $lines[] = '';
    $lines[] = 'Имя: ' . ($l['name'] !== '' ? h($l['name']) : '<i>не указано</i>');
    $lines[] = 'Телефон: ' . ($l['phone'] !== '' ? h($l['phone']) : '<i>не указан</i>');
    if ($l['tg'] !== '') {
        $lines[] = 'Telegram: @' . h($l['tg']);
    }
    if ($l['user']) {
        $lines[] = 'Чат с ботом: <a href="tg://user?id=' . (int) $l['user'] . '">открыть профиль</a>';
    }
    $source = ['form' => 'форма на сайте', 'site' => 'кнопка на сайте', 'bot' => 'написал боту'][$l['source']] ?? $l['source'];
    $lines[] = 'Откуда: ' . $source . ', ' . fmt_time((int) $l['created']);
    $lines[] = '';
    $lines[] = 'Приветствие: ' . ($l['welcome_at']
        ? 'отправлено ' . fmt_time((int) $l['welcome_at']) . ' (' . h(admin_name($db, (int) $l['welcome_by'])) . ')'
        : ($l['user'] ? 'не отправлено' : 'ученик ещё не открыл бота'));
    if ($l['status_by']) {
        $lines[] = 'Статус: ' . h(admin_name($db, (int) $l['status_by'])) . ', ' . fmt_time((int) $l['status_at']);
    }
    $user = $l['user'] ? ($db['users'][$l['user']] ?? []) : [];
    if (!empty($user['blocked'])) {
        $lines[] = '<b>Ученик остановил бота</b>: написать ему через бота нельзя, позвоните.';
    }

    $rows = [];
    if ($l['user'] && empty($user['blocked'])) {
        $rows[] = [
            ['text' => $l['welcome_at'] ? 'Приветствие ещё раз' : 'Отправить приветствие', 'callback_data' => 'w:' . $l['id']],
            ['text' => 'Написать', 'callback_data' => 'r:' . $l['id']],
        ];
    } elseif ($l['tg'] !== '') {
        $rows[] = [['text' => 'Написать @' . $l['tg'] . ' со своего аккаунта', 'url' => 'https://t.me/' . $l['tg'] . '?text=' . rawurlencode(welcome_text($db, $l))]];
    }
    $status = [];
    foreach (['w' => 'В работе', 'b' => 'Записан', 'c' => 'Закрыта'] as $code => $label) {
        $status[] = ['text' => ($l['status'] === $code ? '• ' : '') . $label, 'callback_data' => 's:' . $l['id'] . ':' . $code];
    }
    $rows[] = $status;
    return [implode("\n", $lines), ['inline_keyboard' => $rows]];
}

// Отправляет карточку всем админам и запоминает сообщения, чтобы потом обновлять.
function notify_new_lead(array &$db, int $id, string $prefix = ''): void
{
    [$text, $kb] = lead_card($db, $db['leads'][$id]);
    foreach (array_keys($db['admins']) as $admin) {
        $mid = send((int) $admin, ($prefix !== '' ? $prefix . "\n\n" : '') . $text, ['reply_markup' => $kb]);
        if ($mid) {
            $db['leads'][$id]['msgs'][$admin] = $mid;
        }
    }
}

// Обновляет все копии карточки у всех админов.
function refresh_cards(array &$db, int $id): void
{
    $lead = $db['leads'][$id] ?? null;
    if (!$lead) {
        return;
    }
    [$text, $kb] = lead_card($db, $lead);
    foreach ($lead['msgs'] as $admin => $mid) {
        if (isset($db['admins'][$admin])) {
            edit((int) $admin, (int) $mid, $text, $kb);
        }
    }
}

function notify_admins(array $db, string $text, ?array $kb = null, int $except = 0): void
{
    foreach (array_keys($db['admins']) as $admin) {
        if ((int) $admin !== $except) {
            send((int) $admin, $text, $kb ? ['reply_markup' => $kb] : []);
        }
    }
}

function welcome_text(array $db, array $lead): string
{
    $text = (string) ($db['settings']['welcome'] ?? ELI_DEFAULT_WELCOME);
    $name = $lead['name'] !== '' ? $lead['name'] : '';
    $text = $name === '' ? str_replace([', {имя}', ' {имя}', '{имя}'], '', $text) : str_replace('{имя}', $name, $text);
    return str_replace('{языка}', subject_gen($lead['lang']), $text);
}

function open_lead_of(array $db, int $user): ?int
{
    $id = (int) ($db['users'][$user]['lead'] ?? 0);
    $lead = $db['leads'][$id] ?? null;
    return ($lead && in_array($lead['status'], ['n', 'w'], true)) ? $id : null;
}

// Заявка с формы сайта (send.php). Возвращает код для привязки чата.
function site_form_lead(array $f): ?string
{
    return with_db(function (array &$db) use ($f) {
        $lead = lead_new($db, $f, 'form');
        $token = new_token();
        $db['tokens'][$token] = $lead['id'];
        notify_new_lead($db, $lead['id'], 'Новая заявка с сайта');
        return $token;
    });
}

// ---------------------------------------------------------------- клавиатуры

function admin_keyboard(array $db, int $id): array
{
    $rows = [
        [['text' => 'Новые заявки'], ['text' => 'Все заявки']],
        [['text' => 'Приветствие'], ['text' => 'Помощь']],
    ];
    if (is_owner($db, $id)) {
        $rows[] = [['text' => 'Админы']];
    }
    return ['keyboard' => $rows, 'resize_keyboard' => true, 'is_persistent' => true];
}

function contact_keyboard(): array
{
    return ['keyboard' => [[['text' => 'Отправить номер телефона', 'request_contact' => true]], [['text' => 'Без номера']]], 'resize_keyboard' => true, 'one_time_keyboard' => true];
}

const NO_KEYBOARD = ['remove_keyboard' => true];

// ---------------------------------------------------------------- вход

function handle_update(array $update): void
{
    with_db(function (array &$db) use ($update) {
        $uid = (int) ($update['update_id'] ?? 0);
        if ($uid && in_array($uid, $db['seen'], true)) {
            return; // Telegram прислал то же самое ещё раз
        }
        if ($uid) {
            $db['seen'][] = $uid;
            $db['seen'] = array_slice($db['seen'], -300);
        }
        if (isset($update['message'])) {
            on_message($db, $update['message']);
        } elseif (isset($update['callback_query'])) {
            on_callback($db, $update['callback_query']);
        } elseif (isset($update['my_chat_member'])) {
            on_member($db, $update['my_chat_member']);
        }
    });
}

function on_member(array &$db, array $m): void
{
    $chat = $m['chat'] ?? [];
    $status = $m['new_chat_member']['status'] ?? '';
    if (($chat['type'] ?? '') !== 'private') {
        if (in_array($status, ['member', 'administrator'], true)) {
            tg('leaveChat', ['chat_id' => $chat['id']]); // бот работает только в личных сообщениях
        }
        return;
    }
    $id = (int) ($chat['id'] ?? 0);
    if (isset($db['users'][$id])) {
        $db['users'][$id]['blocked'] = $status === 'kicked';
        $lead = (int) ($db['users'][$id]['lead'] ?? 0);
        if ($lead) {
            refresh_cards($db, $lead);
        }
    }
}

// Админы по имени пользователя: из настроек и добавленные владельцем.
// Имя закрепляется за первым, кто с ним пришёл, дальше проверяется только номер.
function maybe_promote(array &$db, array $from): void
{
    $id = (int) $from['id'];
    $username = strtolower((string) ($from['username'] ?? ''));
    if ($username === '' || isset($db['admins'][$id])) {
        return;
    }
    $fromConfig = in_array($username, array_map('strtolower', (array) cfg()['admin_usernames']), true);
    $pending = in_array($username, $db['pending_admins'], true);
    if (!$fromConfig && !$pending) {
        return;
    }
    if (isset($db['bound'][$username]) && (int) $db['bound'][$username] !== $id) {
        return; // этим именем раньше пользовался другой человек
    }
    $db['bound'][$username] = $id;
    $db['pending_admins'] = array_values(array_diff($db['pending_admins'], [$username]));
    $db['admins'][$id] = ['name' => person_name($from), 'username' => $username, 'role' => 'admin', 'since' => time()];
    notify_admins($db, h(person_name($from)) . ' (@' . h($username) . ') теперь админ бота заявок.', null, $id);
}

function rate_limited(array &$db, int $id): bool
{
    $now = time();
    $times = array_values(array_filter((array) ($db['users'][$id]['times'] ?? []), fn($t) => $t > $now - 60));
    $times[] = $now;
    $db['users'][$id]['times'] = $times;
    if (count($times) > 15) {
        if (count($times) === 16) {
            send_plain($id, 'Слишком много сообщений. Подождите минуту, пожалуйста.');
        }
        return true;
    }
    return false;
}

function on_message(array &$db, array $m): void
{
    $chat = $m['chat'] ?? [];
    $from = $m['from'] ?? [];
    if (($chat['type'] ?? '') !== 'private') {
        tg('leaveChat', ['chat_id' => $chat['id'] ?? 0]);
        return;
    }
    if (!empty($from['is_bot']) || empty($from['id'])) {
        return;
    }
    $id = (int) $from['id'];
    $text = isset($m['text']) && is_string($m['text']) ? $m['text'] : '';

    // владелец: одноразовая ссылка из консоли (php bot/setup.php owner)
    if (preg_match('/^\/start own_([A-Za-z0-9]{16,64})$/', trim($text), $mm)) {
        $code = (string) cfg()['owner_code'];
        if (!$db['owner_claimed'] && $code !== '' && hash_equals($code, $mm[1])) {
            $db['owner_claimed'] = true;
            $db['admins'][$id] = ['name' => person_name($from), 'username' => strtolower((string) ($from['username'] ?? '')), 'role' => 'owner', 'since' => time()];
            admin_greeting($db, $id, true);
            return;
        }
        $text = '/start'; // чужая или использованная ссылка: обычный старт
    }

    maybe_promote($db, $from);

    if (is_admin($db, $id)) {
        on_admin_message($db, $id, $m, $text);
        return;
    }
    if (rate_limited($db, $id)) {
        return;
    }
    on_visitor_message($db, $id, $from, $m, $text);
}

// ---------------------------------------------------------------- ученик

function visitor_record(array &$db, int $id, array $from): void
{
    $db['users'][$id] = ($db['users'][$id] ?? []) + ['name' => '', 'phone' => '', 'lead' => 0, 'ack' => 0, 'blocked' => false, 'times' => []];
    $db['users'][$id]['tg'] = preg_match('/^[A-Za-z0-9_]{4,32}$/', (string) ($from['username'] ?? '')) ? (string) $from['username'] : '';
    $db['users'][$id]['blocked'] = false;
}

function on_visitor_message(array &$db, int $id, array $from, array $m, string $text): void
{
    visitor_record($db, $id, $from);
    $user = $db['users'][$id];
    $text = trim($text);

    if (preg_match('/^\/start(?:\s+(\S+))?$/', $text, $mm)) {
        $payload = $mm[1] ?? '';
        if (preg_match('/^T([A-Za-z0-9]{16})$/', $payload, $tm) && isset($db['tokens'][$tm[1]])) {
            link_form_lead($db, $id, $from, (int) $db['tokens'][$tm[1]]);
            unset($db['tokens'][$tm[1]]);
            return;
        }
        $fields = $payload !== '' ? parse_site_payload($payload) : null;
        if ($fields === null) {
            ask_language($id);
            return;
        }
        start_lead($db, $id, $from, $fields, 'site');
        return;
    }

    if ($text === '/help') {
        send_plain($id, "Это бот записи eli english: частные уроки английского и польского.\n\nНапишите сюда вопрос или удобное время, мы ответим в этом чате. Телефон: " . cfg()['phone']);
        return;
    }

    if (isset($m['contact'])) {
        $c = $m['contact'];
        if ((int) ($c['user_id'] ?? 0) !== $id) {
            send_plain($id, 'Пожалуйста, отправьте свой номер кнопкой «Отправить номер телефона» внизу.', ['reply_markup' => contact_keyboard()]);
            return;
        }
        $phone = '+' . ltrim(preg_replace('/[^\d]/', '', (string) ($c['phone_number'] ?? '')) ?? '', '+');
        $db['users'][$id]['phone'] = $phone;
        $lead = open_lead_of($db, $id);
        if ($lead) {
            $db['leads'][$lead]['phone'] = $phone;
            refresh_cards($db, $lead);
            notify_admins($db, h(lead_display_name($db['leads'][$lead])) . ' оставил(а) номер: ' . h($phone) . ' (заявка №' . $lead . ')');
        }
        send_plain($id, 'Спасибо, номер получили. Скоро свяжемся с вами.', ['reply_markup' => NO_KEYBOARD]);
        return;
    }

    if ($text === 'Без номера') {
        send_plain($id, 'Хорошо, напишем вам здесь. Если появятся вопросы, просто пишите в этот чат.', ['reply_markup' => NO_KEYBOARD]);
        return;
    }

    if ($text === '') {
        send_plain($id, 'Пока я понимаю только текст. Напишите, пожалуйста, словами.');
        return;
    }

    // обычное сообщение: передаём админам, ничего не теряем
    $lead = open_lead_of($db, $id);
    if (!$lead) {
        $fields = ['name' => clean_name(person_name($from)), 'tg' => $db['users'][$id]['tg'], 'user' => $id, 'phone' => $user['phone'] ?? ''];
        $new = lead_new($db, $fields, 'bot');
        $lead = $new['id'];
        $db['users'][$id]['lead'] = $lead;
        notify_new_lead($db, $lead, 'Новый человек написал боту');
    }
    $msg = clean_text($text, 2000, true);
    $kb = ['inline_keyboard' => [[['text' => 'Ответить', 'callback_data' => 'r:' . $lead], ['text' => 'Заявка №' . $lead, 'callback_data' => 'o:' . $lead]]]];
    notify_admins($db, '<b>' . h(lead_display_name($db['leads'][$lead])) . '</b> · заявка №' . $lead . "\n\n" . h($msg), $kb);
    if (time() - (int) ($db['users'][$id]['ack'] ?? 0) > 1800) {
        $db['users'][$id]['ack'] = time();
        send_plain($id, 'Спасибо, передал преподавателю. Ответим здесь в ближайшее время.');
    }
}

function lead_display_name(array $lead): string
{
    return $lead['name'] !== '' ? $lead['name'] : ($lead['tg'] !== '' ? '@' . $lead['tg'] : 'Ученик');
}

function ask_language(int $id): void
{
    send_plain($id, "Здравствуйте! Это eli english: частные уроки английского и польского для детей и взрослых, онлайн и в Санкт-Петербурге.\n\nКакой язык вас интересует?", ['reply_markup' => ['inline_keyboard' => [[
        ['text' => 'Английский', 'callback_data' => 'v:e'],
        ['text' => 'Польский', 'callback_data' => 'v:p'],
    ]]]]);
}

function start_lead(array &$db, int $id, array $from, array $fields, string $source): void
{
    $name = $fields['name'] !== '' ? $fields['name'] : clean_name(person_name($from));
    $phone = $fields['phone'] !== '' ? $fields['phone'] : (string) ($db['users'][$id]['phone'] ?? '');
    $existing = open_lead_of($db, $id);
    if ($existing && time() - (int) $db['leads'][$existing]['created'] < 86400) {
        // уже есть свежая заявка: обновляем её, а не плодим новые
        foreach (['lang', 'who', 'format', 'pack', 'dur'] as $k) {
            if (!empty($fields[$k])) {
                $db['leads'][$existing][$k] = $fields[$k];
            }
        }
        if ($phone !== '') {
            $db['leads'][$existing]['phone'] = $phone;
        }
        refresh_cards($db, $existing);
        send_plain($id, 'Ваша заявка №' . $existing . ' уже у нас, данные обновили. Скоро напишем вам здесь.');
        return;
    }
    $lead = lead_new($db, $fields + ['tg' => $db['users'][$id]['tg'], 'user' => $id, 'test' => is_admin($db, $id)], $source);
    $db['leads'][$lead['id']]['name'] = $name;
    $db['leads'][$lead['id']]['phone'] = $phone;
    $db['users'][$id]['lead'] = $lead['id'];
    notify_new_lead($db, $lead['id'], 'Новая заявка');

    $hello = 'Здравствуйте' . ($name !== '' ? ', ' . $name : '') . '! Это eli english, частные уроки ' . subject_gen($lead['lang']) . ".\n\n"
        . 'Заявка на бесплатный пробный урок принята. Мы напишем вам здесь, в этом чате.';
    if ($phone === '') {
        send_plain($id, $hello . "\n\nЕсли удобнее, чтобы мы позвонили, нажмите «Отправить номер телефона» внизу.", ['reply_markup' => contact_keyboard()]);
    } else {
        send_plain($id, $hello, ['reply_markup' => NO_KEYBOARD]);
    }
}

// Человек оставил заявку в форме на сайте, а потом открыл бота по ссылке.
function link_form_lead(array &$db, int $id, array $from, int $leadId): void
{
    if (!isset($db['leads'][$leadId])) {
        ask_language($id);
        return;
    }
    $db['leads'][$leadId]['user'] = $id;
    $db['leads'][$leadId]['tg'] = $db['users'][$id]['tg'];
    $db['users'][$id]['lead'] = $leadId;
    if ($db['leads'][$leadId]['phone'] !== '') {
        $db['users'][$id]['phone'] = $db['leads'][$leadId]['phone'];
    }
    refresh_cards($db, $leadId);
    notify_admins($db, h(lead_display_name($db['leads'][$leadId])) . ' открыл(а) бота: по заявке №' . $leadId . ' теперь можно отправить приветствие.', ['inline_keyboard' => [[['text' => 'Открыть заявку №' . $leadId, 'callback_data' => 'o:' . $leadId]]]]);
    send_plain($id, 'Готово! Заявка №' . $leadId . ' у нас. Теперь мы сможем ответить вам здесь, в этом чате.', ['reply_markup' => NO_KEYBOARD]);
}

// ---------------------------------------------------------------- админ

function admin_greeting(array $db, int $id, bool $owner = false): void
{
    $name = admin_name($db, $id);
    $text = 'Здравствуйте, ' . h($name) . '! Это кабинет заявок eli english' . ($owner ? ', вы владелец' : '') . ".\n\n"
        . "<b>Как это работает</b>\n"
        . "• Заявки с сайта приходят сюда сами, с кнопками под каждой.\n"
        . "• «Отправить приветствие»: бот напишет ученику готовый текст. Перед отправкой покажу, что уйдёт.\n"
        . "• «Написать»: ваше следующее сообщение бот перешлёт ученику.\n"
        . "• «В работе», «Записан», «Закрыта»: отметки, чтобы не потерять заявку. Их видят все админы.\n"
        . "• Ответы учеников тоже приходят сюда.\n\n"
        . 'Меню внизу: новые и все заявки, текст приветствия, помощь' . ($owner ? ', админы.' : '.');
    $open = count(array_filter($db['leads'], fn($l) => in_array($l['status'], ['n', 'w'], true)));
    if ($open) {
        $text .= "\n\nСейчас открытых заявок: " . $open . '. Нажмите «Новые заявки».';
    }
    send($id, $text, ['reply_markup' => admin_keyboard($db, $id)]);
}

function on_admin_message(array &$db, int $id, array $m, string $text): void
{
    $text = trim($text);
    $state = $db['state'][$id] ?? null;
    $menu = ['Новые заявки', 'Все заявки', 'Приветствие', 'Помощь', 'Админы', '/start', '/help', '/cancel'];

    // админ проверяет сайт: ссылка с сайта создаёт тестовую заявку
    if (preg_match('/^\/start\s+(\S+)$/', $text, $mm)) {
        $fields = parse_site_payload($mm[1]);
        if ($fields !== null) {
            unset($db['state'][$id]);
            $db['users'][$id] = ($db['users'][$id] ?? []) + ['name' => '', 'phone' => '', 'lead' => 0, 'ack' => 0, 'blocked' => false, 'times' => [], 'tg' => ''];
            start_lead($db, $id, $m['from'], $fields, 'site');
            return;
        }
    }

    if ($state && !in_array($text, $menu, true)) {
        if ($state['mode'] === 'reply') {
            admin_reply($db, $id, (int) $state['lead'], $text);
            return;
        }
        if ($state['mode'] === 'welcome') {
            $new = clean_text($text, 1000, true);
            if ($new === '') {
                send($id, 'Нужен текст. Пришлите приветствие одним сообщением или нажмите «Отмена».');
                return;
            }
            $db['settings']['welcome'] = $new;
            unset($db['state'][$id]);
            send($id, "Приветствие сохранено. Так его увидит ученик:\n\n" . h(welcome_text($db, ['name' => 'Анна', 'lang' => 'en'])), ['reply_markup' => admin_keyboard($db, $id)]);
            return;
        }
        if ($state['mode'] === 'add_admin' && is_owner($db, $id)) {
            $username = strtolower(ltrim($text, '@'));
            if (!preg_match('/^[a-z0-9_]{5,32}$/', $username)) {
                send($id, 'Не похоже на имя в Telegram. Пришлите в виде @username или нажмите «Отмена».');
                return;
            }
            if (!in_array($username, $db['pending_admins'], true)) {
                $db['pending_admins'][] = $username;
            }
            if (($db['bound'][$username] ?? 0) === -1) {
                unset($db['bound'][$username]); // раньше убирали, теперь владелец добавил снова
            }
            unset($db['state'][$id]);
            send($id, '@' . h($username) . ' станет админом, когда откроет бота @' . h(cfg()['bot_username']) . ' и нажмёт «Старт».', ['reply_markup' => admin_keyboard($db, $id)]);
            return;
        }
    }
    unset($db['state'][$id]);

    switch ($text) {
        case '/start':
            admin_greeting($db, $id, is_owner($db, $id));
            return;
        case 'Помощь':
        case '/help':
            admin_greeting($db, $id, is_owner($db, $id));
            return;
        case 'Новые заявки':
            show_list($db, $id, 'n', 0);
            return;
        case 'Все заявки':
            show_list($db, $id, 'a', 0);
            return;
        case 'Приветствие':
            send($id, "<b>Текст приветствия</b>\nВместо {имя} подставится имя ученика, вместо {языка}: «английского» или «польского».\n\n" . h((string) $db['settings']['welcome']), ['reply_markup' => ['inline_keyboard' => [[
                ['text' => 'Изменить текст', 'callback_data' => 't:e'],
                ['text' => 'Вернуть стандартный', 'callback_data' => 't:r'],
            ]]]]);
            return;
        case 'Админы':
            if (is_owner($db, $id)) {
                show_admins($db, $id);
                return;
            }
            break;
        case '/cancel':
            send($id, 'Отменено.', ['reply_markup' => admin_keyboard($db, $id)]);
            return;
    }
    send($id, 'Выберите действие в меню внизу или нажмите кнопку под заявкой.', ['reply_markup' => admin_keyboard($db, $id)]);
}

function admin_reply(array &$db, int $id, int $leadId, string $text): void
{
    $lead = $db['leads'][$leadId] ?? null;
    unset($db['state'][$id]);
    $msg = clean_text($text, 3500, true);
    if (!$lead || !$lead['user'] || $msg === '') {
        send($id, 'Не получилось: у заявки нет чата с ботом или пустой текст.', ['reply_markup' => admin_keyboard($db, $id)]);
        return;
    }
    if (send_plain((int) $lead['user'], $msg)) {
        if ($lead['status'] === 'n') {
            set_status($db, $leadId, 'w', $id);
        }
        send($id, 'Отправлено: ' . h(lead_display_name($lead)) . ', заявка №' . $leadId . '.', ['reply_markup' => admin_keyboard($db, $id)]);
    } else {
        delivery_failed($db, $id, $leadId, (int) ($GLOBALS['ELI_TG_ERROR'] ?? 0));
    }
}

// $error: код ошибки Telegram, запомненный сразу после неудачной отправки (403: ученик остановил бота).
function delivery_failed(array &$db, int $admin, int $leadId, int $error): void
{
    $lead = $db['leads'][$leadId];
    if ($error === 403 && $lead['user']) {
        $db['users'][$lead['user']]['blocked'] = true;
        refresh_cards($db, $leadId);
        send($admin, 'Не доставлено: ученик остановил бота.' . ($lead['phone'] !== '' ? ' Позвоните: ' . h($lead['phone']) : ''), ['reply_markup' => admin_keyboard($db, $admin)]);
        return;
    }
    send($admin, 'Не получилось отправить, Telegram не ответил. Попробуйте ещё раз через минуту.', ['reply_markup' => admin_keyboard($db, $admin)]);
}

function set_status(array &$db, int $leadId, string $status, int $admin): void
{
    $db['leads'][$leadId]['status'] = $status;
    $db['leads'][$leadId]['status_by'] = $admin;
    $db['leads'][$leadId]['status_at'] = time();
    refresh_cards($db, $leadId);
}

function show_list(array $db, int $id, string $filter, int $page, ?int $editMessage = null): void
{
    $leads = array_values(array_filter($db['leads'], fn($l) => $filter === 'a' || in_array($l['status'], ['n', 'w'], true)));
    usort($leads, fn($a, $b) => $b['id'] <=> $a['id']);
    $total = count($leads);
    $pages = max(1, (int) ceil($total / ELI_PAGE));
    $page = max(0, min($page, $pages - 1));
    $title = $filter === 'a' ? 'Все заявки' : 'Новые и в работе';
    if ($total === 0) {
        $text = '<b>' . $title . "</b>\n\nПока пусто. Новые заявки придут сюда сами.";
        $editMessage ? edit($id, $editMessage, $text) : send($id, $text);
        return;
    }
    $rows = [];
    foreach (array_slice($leads, $page * ELI_PAGE, ELI_PAGE) as $l) {
        $label = '№' . $l['id'] . ' · ' . cut(lead_display_name($l), 18) . ' · ' . ($l['lang'] === 'pl' ? 'польск.' : 'англ.') . ' · ' . mb_lower_safe(ELI_STATUSES[$l['status']]);
        $rows[] = [['text' => $label, 'callback_data' => 'o:' . $l['id']]];
    }
    $nav = [];
    if ($page > 0) {
        $nav[] = ['text' => '‹ Назад', 'callback_data' => 'p:' . $filter . ':' . ($page - 1)];
    }
    if ($page < $pages - 1) {
        $nav[] = ['text' => 'Дальше ›', 'callback_data' => 'p:' . $filter . ':' . ($page + 1)];
    }
    if ($nav) {
        $rows[] = $nav;
    }
    $text = '<b>' . $title . '</b>: ' . $total . ($pages > 1 ? ', страница ' . ($page + 1) . ' из ' . $pages : '') . "\nНажмите на заявку, чтобы открыть её.";
    $kb = ['inline_keyboard' => $rows];
    $editMessage ? edit($id, $editMessage, $text, $kb) : send($id, $text, ['reply_markup' => $kb]);
}

function mb_lower_safe(string $s): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : $s;
}

function show_admins(array $db, int $id): void
{
    $lines = ['<b>Админы бота</b>'];
    $rows = [];
    foreach ($db['admins'] as $aid => $a) {
        $lines[] = '• ' . h($a['name']) . ($a['username'] ? ' (@' . h($a['username']) . ')' : '') . ($a['role'] === 'owner' ? ', владелец' : '');
        if ($a['role'] !== 'owner') {
            $rows[] = [['text' => 'Убрать ' . cut($a['name'], 20), 'callback_data' => 'a:d:' . $aid]];
        }
    }
    $waiting = array_unique(array_merge(array_map('strtolower', (array) cfg()['admin_usernames']), $db['pending_admins']));
    $waiting = array_values(array_filter($waiting, fn($u) => !isset($db['bound'][$u])));
    if ($waiting) {
        $lines[] = '';
        $lines[] = 'Ещё не открыли бота: ' . implode(', ', array_map(fn($u) => '@' . h($u), $waiting));
    }
    $rows[] = [['text' => 'Добавить админа', 'callback_data' => 'a:a']];
    send($id, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => $rows]]);
}

// ---------------------------------------------------------------- кнопки

function on_callback(array &$db, array $q): void
{
    $id = (int) ($q['from']['id'] ?? 0);
    $data = (string) ($q['data'] ?? '');
    $qid = (string) ($q['id'] ?? '');
    $msg = $q['message'] ?? [];
    $chat = (int) ($msg['chat']['id'] ?? 0);
    $mid = (int) ($msg['message_id'] ?? 0);

    if (!preg_match('/^[a-z]{1,2}(:[a-z0-9]{1,16}){0,2}$/', $data) || ($msg['chat']['type'] ?? 'private') !== 'private') {
        answer($qid);
        return;
    }
    $p = explode(':', $data);

    // кнопки ученика: выбор языка
    if ($p[0] === 'v' && isset($p[1]) && in_array($p[1], ['e', 'p'], true)) {
        answer($qid);
        if (!is_admin($db, $id) && rate_limited($db, $id)) {
            return;
        }
        visitor_record($db, $id, $q['from']);
        start_lead($db, $id, $q['from'], ['lang' => $p[1] === 'p' ? 'pl' : 'en', 'who' => '', 'format' => '', 'pack' => 0, 'dur' => 60, 'phone' => '', 'name' => ''], 'bot');
        return;
    }

    maybe_promote($db, $q['from']);
    if (!is_admin($db, $id)) {
        answer($qid, 'Эта кнопка только для админов.');
        return;
    }

    $leadId = isset($p[1]) && ctype_digit($p[1]) ? (int) $p[1] : 0;
    $lead = $leadId ? ($db['leads'][$leadId] ?? null) : null;

    switch ($p[0]) {
        case 'o': // открыть заявку
            answer($qid);
            if (!$lead) {
                send($id, 'Заявка не найдена.');
                return;
            }
            [$text, $kb] = lead_card($db, $lead);
            $new = send($id, $text, ['reply_markup' => $kb]);
            if ($new) {
                $db['leads'][$leadId]['msgs'][$id] = $new;
            }
            return;

        case 'p': // страница списка
            answer($qid);
            if (isset($p[1], $p[2]) && in_array($p[1], ['n', 'a'], true) && ctype_digit($p[2])) {
                show_list($db, $id, $p[1], (int) $p[2], $mid);
            }
            return;

        case 's': // статус
            if (!$lead || !isset($p[2]) || !isset(ELI_STATUSES[$p[2]])) {
                answer($qid, 'Заявка не найдена.');
                return;
            }
            $newStatus = $lead['status'] === $p[2] ? 'n' : $p[2]; // повторное нажатие снимает отметку
            set_status($db, $leadId, $newStatus, $id);
            answer($qid, 'Статус: ' . ELI_STATUSES[$newStatus]);
            return;

        case 'w': // приветствие: сначала показать, что уйдёт
            answer($qid);
            if (!$lead || !$lead['user']) {
                send($id, 'У этой заявки нет чата с ботом: напишите ученику сами или позвоните.');
                return;
            }
            send($id, 'Отправить ' . h(lead_display_name($lead)) . ' (заявка №' . $leadId . ") это сообщение?\n\n<i>" . h(welcome_text($db, $lead)) . '</i>', ['reply_markup' => ['inline_keyboard' => [[
                ['text' => 'Отправить', 'callback_data' => 'y:' . $leadId],
                ['text' => 'Отмена', 'callback_data' => 'x'],
            ]]]]);
            return;

        case 'y': // приветствие: подтверждено
            if (!$lead || !$lead['user']) {
                answer($qid, 'Заявка не найдена.');
                return;
            }
            if ($lead['welcome_at'] && time() - (int) $lead['welcome_at'] < 60) {
                answer($qid, 'Уже отправлено минуту назад.');
                return; // защита от двойного нажатия
            }
            if (send_plain((int) $lead['user'], welcome_text($db, $lead))) {
                $db['leads'][$leadId]['welcome_at'] = time();
                $db['leads'][$leadId]['welcome_by'] = $id;
                if ($lead['status'] === 'n') {
                    $db['leads'][$leadId]['status'] = 'w';
                    $db['leads'][$leadId]['status_by'] = $id;
                    $db['leads'][$leadId]['status_at'] = time();
                }
                refresh_cards($db, $leadId);
                answer($qid, 'Отправлено');
                edit($id, $mid, 'Приветствие отправлено: ' . h(lead_display_name($lead)) . ', заявка №' . $leadId . '.');
            } else {
                $error = (int) ($GLOBALS['ELI_TG_ERROR'] ?? 0);
                answer($qid, 'Не отправлено');
                edit($id, $mid, 'Приветствие не отправлено.');
                delivery_failed($db, $id, $leadId, $error);
            }
            return;

        case 'r': // написать ученику
            answer($qid);
            if (!$lead || !$lead['user']) {
                send($id, 'У этой заявки нет чата с ботом: напишите ученику сами или позвоните.');
                return;
            }
            $db['state'][$id] = ['mode' => 'reply', 'lead' => $leadId, 'since' => time()];
            send($id, 'Напишите сообщение для ' . h(lead_display_name($lead)) . ' (заявка №' . $leadId . '). Бот перешлёт его от имени eli english.', ['reply_markup' => ['inline_keyboard' => [[['text' => 'Отмена', 'callback_data' => 'x']]]]]);
            return;

        case 'x': // отмена
            unset($db['state'][$id]);
            answer($qid, 'Отменено');
            edit($id, $mid, 'Отменено.');
            return;

        case 't': // текст приветствия
            answer($qid);
            if (($p[1] ?? '') === 'e') {
                $db['state'][$id] = ['mode' => 'welcome', 'since' => time()];
                send($id, "Пришлите новый текст приветствия одним сообщением.\nМожно использовать {имя} и {языка}.", ['reply_markup' => ['inline_keyboard' => [[['text' => 'Отмена', 'callback_data' => 'x']]]]]);
            } elseif (($p[1] ?? '') === 'r') {
                $db['settings']['welcome'] = ELI_DEFAULT_WELCOME;
                send($id, 'Вернул стандартное приветствие.');
            }
            return;

        case 'a': // админы (только владелец)
            if (!is_owner($db, $id)) {
                answer($qid, 'Только для владельца.');
                return;
            }
            answer($qid);
            if (($p[1] ?? '') === 'a') {
                $db['state'][$id] = ['mode' => 'add_admin', 'since' => time()];
                send($id, 'Пришлите имя пользователя нового админа в виде @username.', ['reply_markup' => ['inline_keyboard' => [[['text' => 'Отмена', 'callback_data' => 'x']]]]]);
            } elseif (($p[1] ?? '') === 'd' && isset($p[2]) && ctype_digit($p[2]) && isset($db['admins'][(int) $p[2]]) && $db['admins'][(int) $p[2]]['role'] !== 'owner') {
                $removed = $db['admins'][(int) $p[2]];
                unset($db['admins'][(int) $p[2]], $db['state'][(int) $p[2]]);
                if ($removed['username'] !== '') {
                    $db['pending_admins'] = array_values(array_diff($db['pending_admins'], [$removed['username']]));
                    $db['bound'][$removed['username']] = -1; // имя из настроек больше не даёт доступ
                }
                tg('sendMessage', ['chat_id' => (int) $p[2], 'text' => 'Доступ к кабинету заявок закрыт.', 'reply_markup' => NO_KEYBOARD]);
                send($id, h($removed['name']) . ' больше не админ.');
            }
            return;
    }
    answer($qid);
}

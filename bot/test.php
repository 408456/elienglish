<?php
// Проверка бота без Telegram: php bot/test.php
// Вместо настоящих сообщений все вызовы записываются и проверяются.
declare(strict_types=1);

define('ELI_TEST', true);
define('ELI_DATA_DIR', sys_get_temp_dir() . '/eli-bot-test-' . getmypid());
require __DIR__ . '/lib.php';

$GLOBALS['ELI_CALLS'] = [];
$GLOBALS['ELI_BLOCKED'] = [];
$GLOBALS['ELI_MID'] = 100;

function eli_test_api(string $method, array $params): ?array
{
    $GLOBALS['ELI_CALLS'][] = [$method, $params];
    if (in_array($method, ['sendMessage', 'editMessageText'], true) && in_array((int) ($params['chat_id'] ?? 0), $GLOBALS['ELI_BLOCKED'], true)) {
        $GLOBALS['ELI_TG_ERROR'] = 403;
        return null;
    }
    return $method === 'sendMessage' ? ['result' => ['message_id' => ++$GLOBALS['ELI_MID']]] : ['result' => true];
}

$passed = 0;
$failed = 0;
function check(string $name, bool $ok): void
{
    global $passed, $failed;
    $ok ? $passed++ : $failed++;
    echo ($ok ? '  ок   ' : '  ОШИБКА ') . $name . "\n";
}
function calls(): array
{
    $c = $GLOBALS['ELI_CALLS'];
    $GLOBALS['ELI_CALLS'] = [];
    return $c;
}
function sent_to(array $calls, int $chat): array
{
    return array_values(array_filter($calls, fn($c) => $c[0] === 'sendMessage' && (int) $c[1]['chat_id'] === $chat));
}
function db(): array
{
    return with_db(fn(array &$db) => $db);
}

$upd = 1000;
function msg(int $from, string $text, array $extra = [], string $username = '', string $first = 'Тест'): void
{
    global $upd;
    handle_update(['update_id' => ++$upd, 'message' => [
        'message_id' => $upd, 'chat' => ['id' => $from, 'type' => 'private'],
        'from' => ['id' => $from, 'is_bot' => false, 'first_name' => $first, 'username' => $username],
        'text' => $text,
    ] + $extra]);
}
function press(int $from, string $data, string $username = ''): void
{
    global $upd;
    handle_update(['update_id' => ++$upd, 'callback_query' => [
        'id' => 'q' . $upd, 'data' => $data,
        'from' => ['id' => $from, 'is_bot' => false, 'first_name' => 'Тест', 'username' => $username],
        'message' => ['message_id' => 5, 'chat' => ['id' => $from, 'type' => 'private']],
    ]]);
}
function payload(string $lang, string $who, string $fmt, int $pack, int $dur, string $phone, string $name): string
{
    $head = '1' . ($lang === 'pl' ? 'p' : 'e') . (['adult' => 'a', 'kid' => 'k'][$who] ?? 'x') . (['online' => 'o', 'offline' => 'l'][$fmt] ?? 'x')
        . ([5 => '1', 10 => '2', 20 => '3', 40 => '4'][$pack] ?? '0') . ($dur === 90 ? '9' : '6');
    $digits = substr(preg_replace('/\D/', '', $phone), 0, 15);
    $head .= dechex(strlen($digits)) . $digits;
    return $head . rtrim(strtr(base64_encode($name), '+/', '-_'), '=');
}

const OWNER = 111;
const SISTER = 222;
const VISITOR = 333;
const STRANGER = 444;

echo "Владелец и админы\n";
msg(STRANGER, '/start own_неверныйкод000000000');
check('чужая ссылка владельца не даёт доступ', !is_admin(db(), STRANGER));
calls();
msg(OWNER, '/start own_' . cfg()['owner_code'], [], 'gleb', 'Глеб');
check('владелец по одноразовой ссылке', is_owner(db(), OWNER));
check('владельцу пришло меню', isset(sent_to(calls(), OWNER)[0][1]['reply_markup']['keyboard']));
msg(STRANGER, '/start own_' . cfg()['owner_code']);
check('ссылка владельца второй раз не работает', !is_admin(db(), STRANGER));
calls();
msg(SISTER, '/start', [], 'Eligolc', 'Элли');
check('сестра (@Eligolc) стала админом по имени', is_admin(db(), SISTER) && !is_owner(db(), SISTER));
check('владельцу сообщили о новом админе', count(sent_to(calls(), OWNER)) === 1);

echo "\nЗаявка с сайта через бота\n";
$p = payload('en', 'adult', 'online', 20, 60, '+7 (921) 123-45-67', 'Анна');
check('ссылка с сайта не длиннее 64 символов', strlen($p) <= 64 && preg_match('/^[A-Za-z0-9_-]+$/', $p) === 1);
msg(VISITOR, '/start ' . $p, [], 'anna_test', 'Anna');
$db = db();
$lead = $db['leads'][1] ?? null;
check('заявка создана с данными с сайта', $lead && $lead['name'] === 'Анна' && $lead['phone'] === '+79211234567' && $lead['pack'] === 20 && $lead['user'] === VISITOR);
$c = calls();
check('карточка ушла обоим админам с кнопками', count(sent_to($c, OWNER)) === 1 && count(sent_to($c, SISTER)) === 1 && isset(sent_to($c, SISTER)[0][1]['reply_markup']['inline_keyboard']));
check('ученику пришло подтверждение без разметки', ($v = sent_to($c, VISITOR)) && !isset($v[0][1]['parse_mode']));

echo "\nПриветствие\n";
press(SISTER, 'w:1');
$c = calls();
check('сначала показано, что уйдёт', str_contains(sent_to($c, SISTER)[0][1]['text'] ?? '', 'Отправить'));
check('ученику пока ничего не ушло', count(sent_to($c, VISITOR)) === 0);
press(SISTER, 'y:1');
$c = calls();
$toVisitor = sent_to($c, VISITOR);
check('приветствие отправлено ученику с именем', count($toVisitor) === 1 && str_contains($toVisitor[0][1]['text'], 'Анна') && str_contains($toVisitor[0][1]['text'], 'английского'));
check('заявка отмечена: приветствие и «в работе»', db()['leads'][1]['welcome_at'] > 0 && db()['leads'][1]['status'] === 'w');
check('карточки у админов обновлены', count(array_filter($c, fn($x) => $x[0] === 'editMessageText')) >= 2);
press(SISTER, 'y:1');
check('двойное нажатие не шлёт повторно', count(sent_to(calls(), VISITOR)) === 0);

echo "\nПереписка\n";
press(OWNER, 'r:1');
calls();
msg(OWNER, 'Добрый день! Удобно завтра в 18:00?');
$c = calls();
check('ответ админа переслан ученику', ($t = sent_to($c, VISITOR)) && $t[0][1]['text'] === 'Добрый день! Удобно завтра в 18:00?');
msg(VISITOR, 'Да, <b>удобно</b> & спасибо');
$c = calls();
$fw = sent_to($c, SISTER);
check('ответ ученика пришёл админам, HTML экранирован', $fw && str_contains($fw[0][1]['text'], '&lt;b&gt;удобно&lt;/b&gt; &amp;'));

echo "\nСтатусы и списки\n";
press(SISTER, 's:1:b');
check('статус «Записан»', db()['leads'][1]['status'] === 'b');
press(SISTER, 's:1:b');
check('повторное нажатие снимает отметку', db()['leads'][1]['status'] === 'n');
calls();
msg(SISTER, 'Все заявки');
check('список заявок с кнопками', isset(sent_to(calls(), SISTER)[0][1]['reply_markup']['inline_keyboard'][0][0]['callback_data']));

echo "\nЗащита\n";
calls();
press(STRANGER, 's:1:c');
check('чужой не может менять статус', db()['leads'][1]['status'] === 'n');
press(STRANGER, 'y:1');
check('чужой не может отправить приветствие', count(sent_to(calls(), VISITOR)) === 0);
press(SISTER, 'a:a');
check('админ (не владелец) не управляет админами', !isset(db()['state'][SISTER]));
press(SISTER, 'o:1;drop');
press(SISTER, 'zzzzzz:9999999999999999999');
check('мусорные кнопки игнорируются', true);
msg(VISITOR, 'контакт', ['contact' => ['phone_number' => '+70000000000', 'user_id' => STRANGER]]);
check('чужой контакт не принимается', db()['leads'][1]['phone'] === '+79211234567');
msg(VISITOR, '', ['contact' => ['phone_number' => '79991112233', 'user_id' => VISITOR]]);
check('свой контакт сохраняется', db()['leads'][1]['phone'] === '+79991112233');
calls();
handle_update(['update_id' => ++$upd, 'my_chat_member' => ['chat' => ['id' => -100, 'type' => 'group'], 'new_chat_member' => ['status' => 'member']]]);
check('из групп бот уходит', ($c = calls()) && $c[0][0] === 'leaveChat');
for ($i = 0; $i < 25; $i++) {
    msg(STRANGER, 'спам ' . $i);
}
$spam = sent_to(calls(), SISTER);
check('спам ограничен (не больше 15 сообщений в минуту)', count($spam) <= 16);
$dup = $upd;
handle_update(['update_id' => $dup, 'message' => ['message_id' => 1, 'chat' => ['id' => VISITOR, 'type' => 'private'], 'from' => ['id' => VISITOR, 'first_name' => 'A'], 'text' => 'дубль']]);
check('повтор того же события не обрабатывается', count(calls()) === 0);
msg(VISITOR, '/start 1zzzz');
check('кривая ссылка с сайта не ломает бота', true);
calls();

echo "\nЗаявка из формы сайта (хостинг)\n";
$token = site_form_lead(['name' => 'Ольга', 'phone' => '+79001112233', 'tg' => 'olga_t', 'lang' => 'pl']);
$c = calls();
check('заявка из формы пришла админам', count(sent_to($c, OWNER)) === 1 && preg_match('/^[A-Za-z0-9]{16}$/', (string) $token) === 1);
$formLead = max(array_keys(db()['leads']));
msg(555, '/start T' . $token, [], 'olga_t', 'Olga');
check('ученик открыл бота: чат привязан к заявке', db()['leads'][$formLead]['user'] === 555);
msg(666, '/start T' . $token);
check('код из формы одноразовый', db()['leads'][$formLead]['user'] === 555);
calls();

echo "\nОстановил бота\n";
$GLOBALS['ELI_BLOCKED'][] = 555;
press(SISTER, 'w:' . $formLead);
press(SISTER, 'y:' . $formLead);
check('если ученик остановил бота, админ видит это и телефон', str_contains(implode(' ', array_map(fn($x) => $x[1]['text'] ?? '', sent_to(calls(), SISTER))), 'остановил бота'));

echo "\nВладелец убирает админа\n";
press(OWNER, 'a:d:' . SISTER);
check('сестра больше не админ', !is_admin(db(), SISTER));
msg(SISTER, '/start', [], 'Eligolc');
check('имя из настроек не возвращает доступ после удаления', !is_admin(db(), SISTER));
press(OWNER, 'a:a');
msg(OWNER, '@Eligolc');
msg(SISTER, '/start', [], 'Eligolc');
check('владелец может добавить её снова', is_admin(db(), SISTER));

// уборка
array_map('unlink', array_filter(glob(ELI_DATA_DIR . '/{,.}*', GLOB_BRACE) ?: [], 'is_file'));
@rmdir(ELI_DATA_DIR);

echo "\nИтог: {$passed} проверок прошло, {$failed} с ошибкой\n";
exit($failed ? 1 : 0);

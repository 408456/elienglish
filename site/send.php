<?php
// Принимает заявку с сайта и пересылает её боту в Telegram.
header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex');

function reply(int $code, array $body): void {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    reply(405, ['ok' => false]);
}

$config = require __DIR__ . '/config.php';
$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) {
    $data = $_POST;
}

// Скрытое поле: люди его не видят, а спам-боты заполняют.
if (!empty($data['website'])) {
    reply(200, ['ok' => true]);
}

function clean($value, int $max): string {
    $value = trim(strip_tags((string) ($value ?? '')));
    $value = preg_replace('/\s+/u', ' ', $value);
    return mb_substr($value, 0, $max);
}

$name     = clean($data['name'] ?? '', 80);
$phone    = clean($data['phone'] ?? '', 40);
$telegram = clean($data['telegram'] ?? '', 40);
$subject  = ($data['lang'] ?? 'en') === 'pl' ? 'польский' : 'английский';

if ($name === '' || preg_match_all('/\d/', $phone) < 10) {
    reply(422, ['ok' => false, 'error' => 'fields']);
}

if (empty($config['bot_token']) || empty($config['chat_id'])) {
    reply(503, ['ok' => false, 'error' => 'not_configured']);
}

$text = "Новая заявка на бесплатный урок\n\n"
      . "Язык: {$subject}\n"
      . "Имя: {$name}\n"
      . "Телефон: {$phone}"
      . ($telegram !== '' ? "\nTelegram: {$telegram}" : '');

$ch = curl_init('https://api.telegram.org/bot' . $config['bot_token'] . '/sendMessage');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query(['chat_id' => $config['chat_id'], 'text' => $text]),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
]);
$result = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$ok = $result !== false && $status === 200;
reply($ok ? 200 : 502, ['ok' => $ok]);

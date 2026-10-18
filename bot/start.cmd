@echo off
rem Запуск бота заявок на этом компьютере. Пока окно открыто, бот работает.
chcp 65001 >nul
cd /d "%~dp0.."

set "PHPDIR="
for /d %%I in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\PHP.PHP.8.3_*") do set "PHPDIR=%%~fI"

if defined PHPDIR (
  "%PHPDIR%\php.exe" -d extension_dir="%PHPDIR%\ext" -d extension=openssl -d extension=curl -d extension=mbstring bot\poll.php
) else (
  php bot\poll.php
)
echo.
echo Бот остановлен. Нажмите любую клавишу, чтобы закрыть окно.
pause >nul

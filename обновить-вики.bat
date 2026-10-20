@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Пересобирает вики после правок в папке articles (нужен Node.js: https://nodejs.org)
node tools/build-wiki.mjs
pause

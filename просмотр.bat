@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Собирает вики и открывает сайт в браузере (нужен Node.js: https://nodejs.org)
node tools/build-wiki.mjs
start "" http://localhost:8080/
node tools/serve.mjs

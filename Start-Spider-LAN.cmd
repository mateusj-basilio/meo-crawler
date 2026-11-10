@echo off
setlocal
cd /d "%~dp0"
set "SPIDER_HOST=192.168.0.186"
set "SPIDER_PORT=4318"
echo CSW Sites Crawler na rede local: http://192.168.0.186:4318
echo Mantenha esta janela aberta enquanto outras pessoas estiverem usando o crawler.
node server.mjs

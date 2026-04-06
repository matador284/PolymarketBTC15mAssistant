@echo off
echo =======================================================
echo   POLYMARKET AUTO-ONBOARDING - CONFIGURADOR DE CHAVES
echo =======================================================
echo.
echo Este script vai usar a sua Private Key do .env para
echo falar com a Polymarket e gerar automaticamente o
echo Secret e o Passphrase que estao faltando.
echo.
echo ⚠️ Certifique-se de que a Private Key esta correta no .env!
echo.
pause
echo.
echo Iniciando registro...
node src/onboarding.js
echo.
echo Se o script reportou SUCESSO, verifique seu arquivo .env!
echo Agora voce ja pode rodar o robo normalmente.
echo.
pause

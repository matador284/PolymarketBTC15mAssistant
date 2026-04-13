@echo off
echo ===================================================
echo   GERADOR DE CHAVES API - POLYMARKET
echo   (Metodo oficial da documentacao)
echo ===================================================
echo.
node --env-file=.env gerar_chaves.js
echo.
echo ===================================================
pause

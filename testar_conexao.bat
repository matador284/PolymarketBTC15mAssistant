@echo off
echo ===================================================
echo   DIAGNOSTICO DE CONEXAO POLYMARKET
echo ===================================================
echo.
node --env-file=.env diagnose_final.js
echo.
echo ===================================================
pause

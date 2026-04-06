@echo off
title Analisador de Trades - Polymarket 5m
color 0A
echo =======================================================
echo     ANALISADOR DE RESULTADOS - POLYMARKET 5m (DRY RUN)
echo =======================================================
echo.
echo Lendo os logs em "logs\auto_trades.csv" e cruzando com a Polymarket...
echo Aguarde...
echo.

node resolve_trades.js

echo.
pause

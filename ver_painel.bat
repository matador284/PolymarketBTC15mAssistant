@echo off
title Polymarket Dashboard
color 0A
cls
echo Iniciando Servidor do Painel...
start http://localhost:3000
node painel/server.js
pause

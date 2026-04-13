@echo off
title Polymarket BTC 5m Assistant - Inicializador (Calibrado)
color 0B
cls

echo =======================================================
echo          BEM-VINDO AO POLYMARKET BTC ASSISTANT
echo =======================================================
echo.
echo ===================== AVISO DE USO ====================
echo - Os filtros de seguranca (Falso Topo/Trend) continuam ativos!
echo - Agora as confiancas estao bem mais realistas para o bot ATIRAR.
echo =======================================================
echo.
set /p custom_amount="Qual valor em USD voce deseja por entrada? (Aperte ENTER para usar o padrao de $1): "
if "%custom_amount%"=="" (
    set AUTO_TRADE_AMOUNT_USD=1
) else (
    set AUTO_TRADE_AMOUNT_USD=%custom_amount%
)
echo.
echo Escolha o perfil de operacao do sistema (Valor definido: $%AUTO_TRADE_AMOUNT_USD%):
echo.
echo [1] MODO SNIPER (Vigia a metade final da vela)
echo - Confianca alta (82%% minimo)
echo - Edge minimo: 8%% (Mercado real)
echo - Tempo de Entrada: Espera passar metade da vela (Apenas ultimos 2.5 min)
echo.
echo [2] MODO BALANCEADO (Acao Inteligente)
echo - Confianca boa (76%% minimo)
echo - Edge minimo: 6%%
echo - Tempo de Entrada: Ultimos 3.5 min
echo.
echo [3] MODO RADICAL (Metralhadora Ativada)
echo - Confianca media (70%%) - Vai entrar em quase toda reversao!
echo - Edge minimo: 5%%
echo - Tempo de Entrada: Desde o primeiro minuto (Ate 4.5 min restando)
echo.

set /p mode="Digite o numero do MODO (1, 2 ou 3) e aperte ENTER: "

if "%mode%"=="1" (
    set AUTO_TRADE_MIN_CONFIDENCE=0.82
    set AUTO_TRADE_MIN_EDGE=0.08
    set AUTO_TRADE_MAX_EDGE=0.35
    set AUTO_TRADE_MAX_TIME_LEFT=2.5
    echo Iniciando em Modo SNIPER Ajustado...
) else if "%mode%"=="2" (
    set AUTO_TRADE_MIN_CONFIDENCE=0.76
    set AUTO_TRADE_MIN_EDGE=0.06
    set AUTO_TRADE_MAX_EDGE=0.40
    set AUTO_TRADE_MAX_TIME_LEFT=3.5
    echo Iniciando em Modo BALANCEADO Inteligente...
) else if "%mode%"=="3" (
    set AUTO_TRADE_MIN_CONFIDENCE=0.70
    set AUTO_TRADE_MIN_EDGE=0.05
    set AUTO_TRADE_MAX_EDGE=0.50
    set AUTO_TRADE_MAX_TIME_LEFT=4.5
    echo Iniciando em Modo RADICAL!
) else (
    echo Opcao invalida. Vai carregar os padroes normais do seu arquivo .env.
)

echo.
echo Aguarde, carregando motor de inteligencia...
echo.

echo -------------------------------------------------------
echo  [DIAGNOSTICO] Verificando conexao com a Polymarket...
echo -------------------------------------------------------
node --env-file=.env diagnose_final.js > temp_diagnostic.txt 2>&1
findstr /C:"SUCESSO" temp_diagnostic.txt > nul
if errorlevel 1 (
    echo.
    echo *** ERRO: Falha ao conectar com a Polymarket! ***
    echo.
    type temp_diagnostic.txt
    echo.
    echo -------------------------------------------------------
    echo  Verifique as suas credenciais no arquivo .env
    echo  e rode o gerar_chaves.bat para regenerar as chaves.
    echo -------------------------------------------------------
    del temp_diagnostic.txt
    pause
    exit /b 1
) else (
    echo  [OK] API da Polymarket: CONECTADO E AUTORIZADO!
    del temp_diagnostic.txt
)
echo.

node --env-file=.env src/index.js

pause

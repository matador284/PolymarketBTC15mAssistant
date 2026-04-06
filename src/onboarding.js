import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import fs from "fs";
import path from "path";

const PK = process.env.AUTO_TRADE_PRIVATE_KEY;
if (!PK) {
  console.error("ERRO: AUTO_TRADE_PRIVATE_KEY não encontrado no .env");
  process.exit(1);
}

const wallet = new Wallet(PK);
const client = new ClobClient("https://clob.polymarket.com", 137, wallet);

async function onboard() {
  console.log("Iniciando onboarding automatico na Polymarket...");
  try {
    // 1. Tentar criar as credenciais se não existirem
    // De acordo com a SDK, createBuilderApiKey() cria uma nova chave.
    // Mas antes precisamos de um Passphrase.
    const passphrase = "RoboAssistant_" + Math.random().toString(36).substring(7);
    
    console.log("Registrando nova API Key (Relayer/Builder)...");
    const resp = await client.createBuilderApiKey(passphrase);
    
    if (resp && resp.key && resp.secret) {
        console.log("SUCESSO! Chaves geradas:");
        console.log("Key:", resp.key);
        console.log("Secret:", resp.secret);
        console.log("Passphrase:", passphrase);
        
        // Atualizar o .env
        let envContent = fs.readFileSync(".env", "utf8");
        envContent = envContent.replace(/AUTO_TRADE_API_KEY=.*/, `AUTO_TRADE_API_KEY=${resp.key}`);
        envContent = envContent.replace(/AUTO_TRADE_API_SECRET=.*/, `AUTO_TRADE_API_SECRET=${resp.secret}`);
        envContent = envContent.replace(/AUTO_TRADE_API_PASSPHRASE=.*/, `AUTO_TRADE_API_PASSPHRASE=${passphrase}`);
        
        fs.writeFileSync(".env", envContent);
        console.log("\nArquivo .env atualizado automaticamente!");
    } else {
        console.error("Falha ao gerar chaves. Resposta vazia.");
    }
  } catch (error) {
    console.error("Erro no onboarding:", error.message);
    if (error.message.includes("401")) {
        console.log("DICA: Certifique-se de que sua carteira tem saldo de USDC ou POL na rede Polygon.");
    }
  }
}

onboard();

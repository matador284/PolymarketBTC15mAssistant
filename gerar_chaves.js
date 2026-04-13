import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "ethers";

async function generateKeys() {
  console.log("=== GERADOR DE API KEYS POLYMARKET ===");
  console.log("(Método oficial da documentação)\n");
  
  const pk = process.env.AUTO_TRADE_PRIVATE_KEY;
  if (!pk) {
    console.error("❌ Falta AUTO_TRADE_PRIVATE_KEY no .env");
    return;
  }

  const wallet = new Wallet(pk);
  console.log(`🔑 Endereço da sua Private Key: ${wallet.address}`);
  console.log(`📡 Conectando à Polymarket...\n`);

  // Cria o client SEM credenciais (apenas com a Private Key)
  const client = new ClobClient(
    "https://clob.polymarket.com",
    137,
    wallet
  );

  try {
    // Método oficial: cria ou recupera as credenciais vinculadas à sua PK
    const creds = await client.createOrDeriveApiKey();
    
    // Debug: mostra todas as propriedades retornadas
    console.log("📦 Objeto retornado pela Polymarket:");
    console.log(JSON.stringify(creds, null, 2));
    
    // Suporte a diferentes formatos da biblioteca (key ou apiKey)
    const apiKey = creds.key || creds.apiKey || creds.api_key;
    const secret = creds.secret;
    const passphrase = creds.passphrase;
    
    if (!apiKey) {
      console.error("❌ Não foi possível extrair a API Key. Veja o objeto acima.");
      return;
    }
    
    console.log("\n✅ SUCESSO! Suas credenciais foram geradas:");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`AUTO_TRADE_API_KEY=${apiKey}`);
    console.log(`AUTO_TRADE_API_SECRET=${secret}`);
    console.log(`AUTO_TRADE_API_PASSPHRASE=${passphrase}`);
    console.log("═══════════════════════════════════════════════════════════");
    console.log("\n💎 Copie as 3 linhas acima para o seu .env e rode o testar_conexao.bat!");
  } catch (e) {
    console.error("❌ ERRO ao gerar credenciais:", e.message);
    if (e.message.includes("INVALID_SIGNATURE")) {
      console.log("\n💡 Sua Private Key pode estar incorreta.");
      console.log("Vá em Polymarket -> Settings -> Chave Privada e copie a correta.");
    }
  }
}

generateKeys();

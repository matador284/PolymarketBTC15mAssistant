import { ClobClient, SignatureType } from "@polymarket/clob-client";
import { Wallet, utils } from "ethers";

async function diagnose() {
  console.log("=== DIAGNÓSTICO FINAL DE CREDENCIAIS ===");
  
  const pk = process.env.AUTO_TRADE_PRIVATE_KEY;
  const apiKey = process.env.AUTO_TRADE_API_KEY;
  const secret = process.env.AUTO_TRADE_API_SECRET;
  const passphrase = process.env.AUTO_TRADE_API_PASSPHRASE;
  const funder = process.env.AUTO_TRADE_FUNDER_ADDRESS;

  const wallet = new Wallet(pk);
  const signerAddr = wallet.address;
  
  console.log(`\n📄 DADOS DETECTADOS:`);
  console.log(`- Signer (Sua Private Key): ${signerAddr}`);
  console.log(`- Funder (Endereço no .env): ${funder}`);
  
  const sigType = funder ? 1 : 0; 
  console.log(`- SignatureType Escolhido para teste: ${sigType} (${sigType === 1 ? "POL_PROXY" : "EOA"})`);

  try {
    const client = new ClobClient("https://clob.polymarket.com", 137, wallet, {
      key: apiKey,
      secret: secret,
      passphrase: passphrase,
    }, sigType, funder);

    console.log("\n📡 Tentando getApiKeys()...");
    const res = await client.getApiKeys();
    console.log("📥 Resposta:", res);

    if (res.error) {
       console.log("\n❌ ERRO DETECTADO:", res.error);
       if (res.error.includes("Unauthorized")) {
          console.log("\n💡 ANALISE:");
          console.log("O Signer (quem assina) nao tem permissao para usar essas chaves API.");
          console.log("Isso acontece se as chaves no site foram criadas por uma conta e voce esta usando o PK de outra.");
       }
    } else {
       console.log("\n✅ SUCESSO! Conexão estabelecida.");
    }

  } catch (e) {
    console.log("\n💥 CRASH NA CONEXÃO:", e.message);
  }
}

diagnose();

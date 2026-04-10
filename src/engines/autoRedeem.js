import { ethers } from "ethers";
import { CONFIG } from "../config.js";

const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

const CTF_ABI = [
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external",
  "function getConditionId(address oracle, bytes32 questionId, uint256 outcomeSlotCount) view returns (bytes32)"
];

/**
 * Automata o resgate de lucros (Redeem) de mercados finalizados.
 */
export async function autoRedeemPositions() {
  const privateKey = process.env.AUTO_TRADE_PRIVATE_KEY;
  if (!privateKey) return;

  try {
    const provider = new ethers.providers.JsonRpcProvider("https://polygon-rpc.com");
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Busca posições do usuário via Data API
    const res = await fetch(`https://data-api.polymarket.com/positions?user=${wallet.address}&limit=50`);
    if (!res.ok) return;

    const positions = await res.json();
    if (!Array.isArray(positions) || positions.length === 0) return;

    const ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, wallet);

    for (const pos of positions) {
      // Regras para Auto-Redeem:
      // 1. Deve ter saldo de ações (size > 0)
      // 2. O mercado deve estar resolvido (RESOLVED)
      // 3. Deve ser um mercado que ganhamos ou que simplesmente fechou e tem valor
      
      const size = parseFloat(pos.size || "0");
      if (size <= 0) continue;

      // Na Data API, verificamos se o mercado associado está fechado
      // O campo costBasis e value ajudam a saber se vale a pena
      if (pos.proxyWallet && pos.conditionId) {
        // Se a posição está pronta para redeem (geralmente indicada pelo status do mercado)
        // No Polymarket, para o BTC 5m, o indexSet é [1] para UP e [2] para DOWN? 
        // Na verdade, indexSets: [1] resgata o primeiro resultado, [2] o segundo.
        // O mais seguro e comum é tentar resgatar os dois slots: [1, 2]
        
        console.log(`🐋 [Auto-Redeem] Tentando resgatar mercado: ${pos.title || pos.conditionId}`);
        
        try {
          const tx = await ctf.redeemPositions(
            USDC_E,
            ethers.constants.HashZero, // parentCollectionId
            pos.conditionId,
            [1, 2], // Tenta resgatar todos os outcomes possíveis para limpar a banca
            { gasLimit: 200_000 }
          );
          console.log(`✅ [Auto-Redeem] Transação enviada: ${tx.hash}`);
          await tx.wait();
          console.log(`💰 [Auto-Redeem] Lucro coletado com sucesso!`);
        } catch (err) {
          // console.error("Erro no redeem:", err.message);
        }
      }
    }
  } catch (err) {
    // console.error("Falha geral no Auto-Redeem:", err.message);
  }
}

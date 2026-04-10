import { ethers } from "ethers";
import { CONFIG } from "../config.js";

// USDC.e contract no Polygon (6 decimais)
const USDC_CONTRACT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

let cachedBalance = null;
let lastFetchMs = 0;
const CACHE_TTL_MS = 60_000; // Atualiza a cada 60 segundos

/**
 * Busca o saldo USDC da carteira do trader na rede Polygon.
 * Usa cache para não sobrecarregar o RPC.
 */
export async function getWalletBalance() {
  const privateKey = process.env.AUTO_TRADE_PRIVATE_KEY;
  if (!privateKey) {
    return { ok: false, usdc: null, address: null };
  }

  const now = Date.now();
  if (cachedBalance !== null && (now - lastFetchMs < CACHE_TTL_MS)) {
    return cachedBalance;
  }

  // Tenta múltiplos RPCs para resiliência
  const rpcUrls = [
    "https://polygon-rpc.com",
    "https://rpc.ankr.com/polygon",
    "https://polygon.llamarpc.com"
  ];

  for (const rpcUrl of rpcUrls) {
    try {
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const wallet = new ethers.Wallet(privateKey);
      const address = wallet.address;

      const usdc = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, provider);
      const rawBalance = await usdc.balanceOf(address);
      const balance = parseFloat(ethers.utils.formatUnits(rawBalance, 6));

      const result = { ok: true, usdc: balance, address };
      cachedBalance = result;
      lastFetchMs = now;
      return result;
    } catch (e) {
      // Tenta próximo RPC
      continue;
    }
  }

  return { ok: false, usdc: null, address: null };
}

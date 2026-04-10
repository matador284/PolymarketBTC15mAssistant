import { ethers } from "ethers";
import { CONFIG } from "../config.js";

const USDC_E_CONTRACT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_NATIVE_CONTRACT = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

let cachedBalance = null;
let lastFetchMs = 0;
const CACHE_TTL_MS = 0; // Desabilitado para debug

export async function getWalletBalance() {
  const privateKey = CONFIG.autoTrade.privateKey;
  if (!privateKey) return { ok: false, usdc: 0, address: null };

  try {
    const wallet = new ethers.Wallet(privateKey);
    const address = wallet.address;

    // Interface ERC20 para o balanceOf
    const iface = new ethers.utils.Interface(ERC20_ABI);
    const data = iface.encodeFunctionData("balanceOf", [address]);

    // Timeout de 5 segundos para não travar o robô
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch("https://polygon.llamarpc.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: USDC_NATIVE_CONTRACT, data: data }, "latest"]
      })
    });
    
    clearTimeout(timeout);

    const json = await response.json();
    if (json.error) throw new Error(json.error.message);

    const balance = ethers.BigNumber.from(json.result);
    const formatted = parseFloat(ethers.utils.formatUnits(balance, 6));

    return { ok: true, usdc: formatted, address };
  } catch (e) {
    // console.error("Balance Check Error:", e.message);
    return { ok: false, usdc: 0, address: null, error: e.message };
  }
}

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

    // Chama o RPC via fetch (mais robusto que provider.balanceOf)
    const response = await fetch("https://polygon-rpc.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to: USDC_NATIVE_CONTRACT,
            data: data
          },
          "latest"
        ]
      })
    });

    const json = await response.json();
    if (json.error) throw new Error(json.error.message);

    const balance = ethers.BigNumber.from(json.result);
    const formatted = parseFloat(ethers.utils.formatUnits(balance, 6));

    return { ok: true, usdc: formatted, address };
  } catch (e) {
    return { ok: false, usdc: 0, address: null };
  }
}

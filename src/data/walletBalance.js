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
const CACHE_TTL_MS = 30_000; // 30 segundos

export async function getWalletBalance() {
  const privateKey = CONFIG.autoTrade.privateKey;
  if (!privateKey) {
    return { ok: false, usdc: 0, address: null };
  }

  const now = Date.now();
  if (cachedBalance !== null && (now - lastFetchMs < CACHE_TTL_MS)) {
    return cachedBalance;
  }

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

      // Checa os dois tipos de USDC que a Polymarket usa
      const usdcE = new ethers.Contract(USDC_E_CONTRACT, ERC20_ABI, provider);
      const usdcN = new ethers.Contract(USDC_NATIVE_CONTRACT, ERC20_ABI, provider);

      const [balE, balN] = await Promise.all([
        usdcE.balanceOf(address).catch(() => ethers.BigNumber.from(0)),
        usdcN.balanceOf(address).catch(() => ethers.BigNumber.from(0))
      ]);

      const totalUSDC = parseFloat(ethers.utils.formatUnits(balE.add(balN), 6));

      const result = { ok: true, usdc: totalUSDC, address };
      cachedBalance = result;
      lastFetchMs = now;
      return result;
    } catch (e) {
      continue;
    }
  }

  return { ok: false, usdc: 0, address: null };
}

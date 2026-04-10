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
      const eoaAddress = wallet.address;
      
      // Tenta descobrir o Proxy Wallet via Data API
      let proxyAddress = eoaAddress;
      
      // FALLBACK MANUAL: Endereço que encontramos no seu browser onde está o dinheiro
      const KNOWN_PROXY = "0x01540e13dDd6793b2698dB5B7222f2c0ABf9fF18";
      
      try {
        const res = await fetch(`https://data-api.polymarket.com/positions?user=${eoaAddress}&limit=1`);
        if (res.ok) {
          const pos = await res.json();
          if (pos && pos.length > 0 && pos[0].proxyWallet) {
            proxyAddress = pos[0].proxyWallet;
          } else {
            proxyAddress = KNOWN_PROXY; // Usa o endereço confirmado se a API estiver vazia
          }
        } else {
          proxyAddress = KNOWN_PROXY;
        }
      } catch (e) {
        proxyAddress = KNOWN_PROXY;
      }

      const usdcE = new ethers.Contract(USDC_E_CONTRACT, ERC20_ABI, provider);
      const usdcN = new ethers.Contract(USDC_NATIVE_CONTRACT, ERC20_ABI, provider);

      // Checa saldo no EOA e no Proxy
      const zero = ethers.BigNumber.from(0);
      const [balEeoa, balNeoa, balEproxy, balNproxy] = await Promise.all([
        usdcE.balanceOf(eoaAddress).catch(() => zero),
        usdcN.balanceOf(eoaAddress).catch(() => zero),
        (proxyAddress && proxyAddress !== eoaAddress) ? usdcE.balanceOf(proxyAddress).catch(() => zero) : Promise.resolve(zero),
        (proxyAddress && proxyAddress !== eoaAddress) ? usdcN.balanceOf(proxyAddress).catch(() => zero) : Promise.resolve(zero),
      ]);

      const totalUSDC = parseFloat(ethers.utils.formatUnits(
        balEeoa.add(balNeoa).add(balEproxy).add(balNproxy), 
        6
      ));

      const result = { ok: true, usdc: totalUSDC, address: proxyAddress };
      cachedBalance = result;
      lastFetchMs = now;
      return result;
    } catch (e) {
      continue;
    }
  }

  return { ok: false, usdc: 0, address: null };
}

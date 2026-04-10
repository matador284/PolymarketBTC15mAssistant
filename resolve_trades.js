import fs from "fs";

const GAMMA_URL = "https://gamma-api.polymarket.com/events?slug=";

async function run() {
  let csv;
  try {
    csv = fs.readFileSync("./logs/auto_trades.csv", "utf8");
  } catch (err) {
    console.log("⚠️  Ainda não há nenhum trade registrado no arquivo CSV!");
    console.log("O bot (Modo Sniper) provavelmente ainda não encontrou uma oportunidade com 85% de confiança.");
    console.log("Deixe ele rodando e volte mais tarde!");
    return;
  }
  
  const lines = csv.split("\n").filter(l => l.trim().length > 0).slice(1);
  
  let wins = 0;
  let losses = 0;
  let unresolved = 0;

  console.log("Analyzing Trades P&L...\n");
  console.log("DATE/TIME\tMARKET\t\tSIDE\tEDGE\tCONF\tRESULT\t\tPROFIT ($)");
  console.log("-".repeat(105));

  let totalNetProfit = 0;

  for (const line of lines) {
    const parts = line.split(",");
    const rawTs = new Date(parts[0]);
    const ts = `${String(rawTs.getDate()).padStart(2, '0')}/${String(rawTs.getMonth() + 1).padStart(2, '0')} ${parts[0].substring(11, 16)}`;
    const slug = parts[1];
    const side = parts[2];
    const amount = parseFloat(parts[3]) || 10;
    const edge = parseFloat(parts[5]);
    const conf = parseFloat(parts[4]);
    const avgPrice = parseFloat(parts[10]) || 0.5; // Estimated execution price

    try {
      const res = await fetch(GAMMA_URL + slug);
      const data = await res.json();
      
      const event = data[0];
      if (!event) {
        console.log(`${ts}\t${slug.substring(13, 23)}\t${side}\t${(edge*100).toFixed(0)}%\t${(conf*100).toFixed(0)}%\tUNKNOWN\t\t-`);
        continue;
      }
      
      const market = event.markets?.[0];
      let result = "PENDING";
      let actualWinner = null;
      let profit = 0;
      
      if (market && market.closed) {
        const prices = JSON.parse(market.outcomePrices || "[]");
        const outcomes = JSON.parse(market.outcomes || "[]");
        let winningIndex = -1;
        if (prices[0] === "1" || prices[0] === 1) winningIndex = 0;
        else if (prices[1] === "1" || prices[1] === 1) winningIndex = 1;
        
        if (winningIndex !== -1) {
             actualWinner = outcomes[winningIndex].toUpperCase();
        }
      }
      
      if (actualWinner) {
        if (actualWinner === side) {
           result = "✅ WIN";
           wins++;
           const sharePrice = Math.max(0.01, Math.min(0.99, conf - edge));
           profit = (amount / sharePrice) - amount;
           totalNetProfit += profit;
        } else {
           result = "❌ LOSS";
           losses++;
           profit = -amount;
           totalNetProfit += profit;
        }
      } else {
         unresolved++;
      }
      
      const profitStr = profit !== 0 ? `${profit >= 0 ? "+" : ""}$${profit.toFixed(2)}` : "-";
      console.log(`${ts}\t${slug.substring(13, 26)}\t${side}\t${(edge*100).toFixed(1)}%\t${(conf*100).toFixed(1)}%\t${result}\t\t${profitStr}`);
      
    } catch(e) {
      console.log(`${ts}\t${slug.substring(13, 23)}\t${side}\tERR`);
    }
  }

  console.log("-".repeat(95));
  console.log(`TOTAL TRADES: ${wins + losses + unresolved}`);
  console.log(`WINS:   ${wins}`);
  console.log(`LOSSES: ${losses}`);
  console.log(`SALDO LIQUIDO ESTIMADO: US$ ${totalNetProfit.toFixed(2)}`);
  if (wins + losses > 0) {
    console.log(`WIN RATE: ${((wins / (wins + losses)) * 100).toFixed(2)}%`);
  }
}

run();

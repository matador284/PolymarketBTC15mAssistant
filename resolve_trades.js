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
  console.log("TIME\t\tMARKET\t\t\tSIDE\tEDGE\tCONF\tRESULT");
  console.log("-".repeat(80));

  for (const line of lines) {
    const parts = line.split(",");
    const ts = parts[0].substring(11, 16);
    const slug = parts[1];
    const side = parts[2];
    const edge = parseFloat(parts[5]);
    const conf = parseFloat(parts[4]);

    try {
      const res = await fetch(GAMMA_URL + slug);
      const data = await res.json();
      
      const event = data[0];
      if (!event) {
        console.log(`${ts}\t${slug.substring(13, 23)}\t${side}\t${(edge*100).toFixed(0)}%\t${(conf*100).toFixed(0)}%\tUNKNOWN`);
        continue;
      }
      
      const market = event.markets?.[0];
      let result = "PENDING";
      let actualWinner = null;
      
      if (market && market.closed) {
        // Find which outcome won (usually price = 1)
        const prices = JSON.parse(market.outcomePrices || "[]");
        const outcomes = JSON.parse(market.outcomes || "[]");
        
        let winningIndex = -1;
        
        // If it's closed and resolved, check condition
        // In some gamma endpoints, closed markets have outcomePrices like ["1", "0"]
        if (prices[0] === "1" || prices[0] === 1) winningIndex = 0;
        else if (prices[1] === "1" || prices[1] === 1) winningIndex = 1;
        
        // Another way is to check the asset price at the end, but Polymarket resolves it exactly.
        if (winningIndex !== -1) {
             actualWinner = outcomes[winningIndex].toUpperCase();
        }
      }
      
      if (actualWinner) {
        if (actualWinner === side) {
           result = "✅ WIN";
           wins++;
        } else {
           result = "❌ LOSS";
           losses++;
        }
      } else {
         unresolved++;
      }
      
      console.log(`${ts}\t${slug.substring(13, 26)}\t${side}\t${(edge*100).toFixed(1)}%\t${(conf*100).toFixed(1)}%\t${result}`);
      
    } catch(e) {
      console.log(`${ts}\t${slug.substring(13, 23)}\t${side}\tERR`);
    }
  }

  console.log("-".repeat(80));
  console.log(`TOTAL TRADES: ${wins + losses + unresolved}`);
  console.log(`WINS:   ${wins}`);
  console.log(`LOSSES: ${losses}`);
  if (wins + losses > 0) {
    console.log(`WIN RATE: ${((wins / (wins + losses)) * 100).toFixed(2)}%`);
  }
}

run();

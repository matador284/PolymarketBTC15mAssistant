import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/trades", (req, res) => {
  try {
    const csvPath = path.join(__dirname, "../logs/auto_trades.csv");
    if (!fs.existsSync(csvPath)) {
      return res.json([]);
    }

    const fileContent = fs.readFileSync(csvPath, "utf-8");
    
    // Ler o CSV manualmente lidando com vírgulas dentro de mensagens de erro ("...")
    const lines = fileContent.split('\n');
    const records = [];
    
    for (let i = 1; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        
        // Expressão regular complexa para separar por vírgulas mas ignorar dentro de aspas
        const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
        if (!matches || matches.length < 13) continue;

        records.push({
            timestamp: matches[0],
            market: matches[1],
            side: matches[2],
            amount: matches[3],
            confidence: matches[4],
            edge: matches[5],
            phase: matches[6],
            strength: matches[7],
            timeLeft: matches[8],
            price: matches[9],
            status: matches[12].replace(/(^"|"$)/g, '')
        });
    }

    // Retorna do mais recente pro mais antigo
    res.json(records.reverse());
  } catch (err) {
    console.error("Erro ao ler CSV:", err);
    res.status(500).json({ error: "Falha ao carregar trades" });
  }
});

app.listen(port, () => {
  console.log(`\n==========================================`);
  console.log(`🚀 Painel Web iniciado com sucesso!!!`);
  console.log(`👉 ACESSE: http://localhost:${port}`);
  console.log(`==========================================\n`);
});

import fs from "fs";

/**
 * Optimizer Engine (Self-Learning)
 * Reads current performance and provides bias adjustments.
 */
export async function getSelfLearningBias(csvPath = "./logs/auto_trades.csv") {
  try {
    if (!fs.existsSync(csvPath)) return { upBias: 0, downBias: 0, efficiency: 1.0, totalAnalyzed: 0 };

    const content = fs.readFileSync(csvPath, "utf8");
    const lines = content.split("\n").filter(l => l.trim().length > 0).slice(1);
    
    if (lines.length < 5) return { upBias: 0, downBias: 0, efficiency: 1.0, totalAnalyzed: lines.length };

    // We only look at the last 50 trades for "recent" learning
    const recentLines = lines.slice(-50);
    
    let upWins = 0, upLosses = 0;
    let downWins = 0, downLosses = 0;

    // Note: This assumes results are resolved. 
    // Since auto_trades.csv currently only logs entries, 
    // we need to match them with results from resolve_trades.js logic.
    // FOR NOW: We'll boost the side that has the most entries IF the user is happy,
    // OR we will implement a "Smart Confidence" filter.
    
    // BETTER: Let's assume for this version that we boost based on trend consistency.
    // (Actual win/loss analysis requires Gamma API calls, which is slow for a loop).
    
    // NOVO: Em vez de dar bias por "streak" (que vicia o robô),
    // vamos apenas monitorar a eficiência. O bias agora é NEUTRO para permitir
    // que o robô volte a dar entradas em ambas as direções baseadas puramente nos indicadores.
    const upBias = 0;
    const downBias = 0;

    return {
      upBias,
      downBias,
      streak: `${streakCount}x ${currentStreakSide}`,
      totalAnalyzed: lines.length
    };
  } catch (err) {
    return { upBias: 0, downBias: 0, efficiency: 1.0, totalAnalyzed: 0 };
  }
}

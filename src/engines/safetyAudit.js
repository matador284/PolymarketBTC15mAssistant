import fs from 'fs';
import path from 'path';

const AUDIT_FILE = './logs/safety_audit.json';

export class SafetyAudit {
  static logCheck(decision, rules, results) {
    try {
      const dir = path.dirname(AUDIT_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const entry = {
        timestamp: new Date().toISOString(),
        market: decision.marketSlug || decision.marketId,
        signal: decision.side,
        action: results.passed ? "TRADE_APPROVE" : "TRADE_REJECT",
        reason: results.reason,
        details: results.details,
        metrics: {
          confidence: decision.confidence,
          edge: decision.edge,
          timeLeft: decision.timeLeftMin
        }
      };

      // Mantém apenas os últimos 100 logs para não pesar
      let logs = [];
      if (fs.existsSync(AUDIT_FILE)) {
        try {
          logs = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
        } catch (e) { logs = []; }
      }
      
      logs.push(entry);
      if (logs.length > 100) logs.shift();

      fs.writeFileSync(AUDIT_FILE, JSON.stringify(logs, null, 2));
    } catch (e) {
      // Silently fail to not crash the main loop
    }
  }
}

let cachedBriefing = null;
let lastBriefingTime = 0;
const BRIEFING_CACHE_MS = 60 * 60 * 1000; // Analisa a cada 1 hora

/**
 * Função principal que atua como o "Analista Chefe" (Hermes-Like).
 * Puxa dados do mercado e consulta uma LLM para obter o viés e o sentimento geral.
 */
export async function getAIBriefing(klines1d, klines1w) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { enabled: false, bias: 0, sentiment: "Off", reasoning: "Nenhuma API Key do Gemini configurada." };
  }

  const now = Date.now();
  if (cachedBriefing && (now - lastBriefingTime < BRIEFING_CACHE_MS)) {
    return cachedBriefing;
  }

  try {
    // 1. Coleta o Índice Fear & Greed pra dar de contexto pra IA
    let fgValue = 50;
    try {
      const fgRes = await fetch("https://api.alternative.me/fng/");
      const fgData = await fgRes.json();
      fgValue = parseInt(fgData.data[0].value, 10);
    } catch(e) {
      // ignora falha
    }

    // 2. Prepara o contexto de preços
    const dPrices = klines1d.slice(-10).map(k => k.close).join(", ");
    const wPrices = klines1w.slice(-5).map(k => k.close).join(", ");
    
    const prompt = `
    Você é um experiente Analista Quantitativo de Criptomoedas com foco em Bitcoin de alta frequência.
    Analise os seguintes dados e forneça sua avaliação do cenário atual para trading direcional (UP/DOWN).
    
    DADOS DO MERCADO:
    - Índice Fear & Greed: ${fgValue}/100
    - Últimos 10 Dias de Fechamento (USD): ${dPrices}
    - Últimas 5 Semanas de Fechamento (USD): ${wPrices}
    
    INSTRUÇÕES:
    Responda EXCLUSIVAMENTE em formato JSON com as seguintes chaves:
    "sentiment": String curta com o viés do mercado (ex: "BULLISH", "BEARISH", "NEUTRAL", "VOLATILE")
    "bias": Um número float entre -0.05 (Forte queda) e +0.05 (Forte alta). Se for neutro, 0.0.
    "reasoning": Um parágrafo muito curto explicando a sua decisão (no máximo 20 palavras).
    `;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1, // temperatura baixa para análise mais focada
          responseMimeType: "application/json"
        }
      })
    });

    const data = await response.json();
    const rawText = data.candidates[0].content.parts[0].text;
    const aiResult = JSON.parse(rawText);

    // Salva o briefing em memória para usar pelas próximas 1h sem gastar API
    cachedBriefing = {
      enabled: true,
      bias: parseFloat(aiResult.bias) || 0,
      sentiment: aiResult.sentiment || "NEUTRAL",
      reasoning: aiResult.reasoning || "Análise concluída."
    };
    lastBriefingTime = now;

    return cachedBriefing;

  } catch (error) {
    return { enabled: true, bias: 0, sentiment: "ERROR", reasoning: "Falha ao consultar a API de IA." };
  }
}

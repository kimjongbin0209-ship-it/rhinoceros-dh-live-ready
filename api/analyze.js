const FRAMES = [
  "Fascism / Totalitarianism",
  "Conformity / Herd Mentality",
  "Identity / Dehumanization",
  "Absurdism / Satire",
  "Contemporary Political Resonance",
  "Performance / Staging",
  "Insufficient Evidence"
];

const SCORE_KEYS = [
  "fascism_totalitarianism",
  "conformity_herd_mentality",
  "identity_dehumanization",
  "absurdism_satire",
  "contemporary_political_resonance",
  "performance_staging"
];

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dominant_frame: { type: "string", enum: FRAMES },
    secondary_frames: {
      type: "array",
      items: { type: "string", enum: FRAMES.filter(f => f !== "Insufficient Evidence") },
      maxItems: 3
    },
    scores: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(SCORE_KEYS.map(k => [k, { type: "number", minimum: 0, maximum: 1 }])),
      required: SCORE_KEYS
    },
    evidence_keywords: {
      type: "array",
      items: { type: "string" },
      minItems: 3,
      maxItems: 8
    },
    explanation: { type: "string" },
    uncertainty: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["dominant_frame", "secondary_frames", "scores", "evidence_keywords", "explanation", "uncertainty"]
};

const systemPrompt = `You are an interpretive coding assistant for a Digital Humanities project on Eugène Ionesco's Rhinoceros.
Classify reception texts into predefined interpretive frames.
Do not invent evidence. Base your classification only on the supplied text.
The LLM is not a final literary judge; it is a coding assistant for comparison.
Return only valid JSON matching the requested schema.`;

function buildUserPrompt(text) {
  return `Analyze the following reception text about Eugène Ionesco's Rhinoceros.

Interpretive frames:
1. Fascism / Totalitarianism
2. Conformity / Herd Mentality
3. Identity / Dehumanization
4. Absurdism / Satire
5. Contemporary Political Resonance
6. Performance / Staging

Return JSON with:
- dominant_frame
- secondary_frames
- scores from 0 to 1 for all six frames. Important: if a frame is explicitly mentioned, give it a nonzero score; if dominant_frame is not Insufficient Evidence, the dominant frame score should normally be at least 0.75.
- evidence_keywords
- explanation
- uncertainty: low / medium / high

Text:
"""
${text}
"""`;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function extractJson(text) {
  if (!text || typeof text !== "string") throw new Error("Empty model response");
  try { return JSON.parse(text); } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in model response");
  return JSON.parse(match[0]);
}

function frameToScoreKey(frame) {
  return {
    "Fascism / Totalitarianism": "fascism_totalitarianism",
    "Conformity / Herd Mentality": "conformity_herd_mentality",
    "Identity / Dehumanization": "identity_dehumanization",
    "Absurdism / Satire": "absurdism_satire",
    "Contemporary Political Resonance": "contemporary_political_resonance",
    "Performance / Staging": "performance_staging"
  }[frame] || null;
}

function inferScoreHints(result) {
  const hints = {};
  const dominantKey = frameToScoreKey(result?.dominant_frame);
  if (dominantKey) hints[dominantKey] = Math.max(hints[dominantKey] || 0, 0.85);
  if (Array.isArray(result?.secondary_frames)) {
    for (const frame of result.secondary_frames.slice(0, 3)) {
      const key = frameToScoreKey(frame);
      if (key) hints[key] = Math.max(hints[key] || 0, 0.6);
    }
  }
  const kwText = Array.isArray(result?.evidence_keywords) ? result.evidence_keywords.join(' ').toLowerCase() : '';
  const keywordHints = [
    ['fascism_totalitarianism', ['fascism','fascist','nazi','nazism','totalitarian','authoritarian','iron guard']],
    ['conformity_herd_mentality', ['conformity','conformism','herd','groupthink','peer pressure','social pressure','collective']],
    ['identity_dehumanization', ['identity','individuality','dehumanization','dehumanisation','humanity','loss of individuality','animalization','animalisation']],
    ['absurdism_satire', ['absurd','satire','farce','comic','grotesque']],
    ['contemporary_political_resonance', ['contemporary','modern','today','current','political resonance','populism','polarization']],
    ['performance_staging', ['performance','staging','production','theatre','director','broadway']]
  ];
  for (const [key, words] of keywordHints) {
    if (words.some(w => kwText.includes(w))) hints[key] = Math.max(hints[key] || 0, 0.45);
  }
  return hints;
}

function normalizeResult(result) {
  const scores = result?.scores || {};
  const normalizedScores = {};
  for (const key of SCORE_KEYS) {
    const n = Number(scores[key]);
    normalizedScores[key] = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  }

  // Some models occasionally return the correct frame labels but leave score fields at 0.
  // Repair that case so the visualization remains meaningful.
  const scoreSum = SCORE_KEYS.reduce((acc, key) => acc + normalizedScores[key], 0);
  if (scoreSum < 0.05) {
    const hints = inferScoreHints(result);
    for (const key of SCORE_KEYS) {
      normalizedScores[key] = hints[key] || 0.08;
    }
  }

  const dominant = FRAMES.includes(result?.dominant_frame) ? result.dominant_frame : "Insufficient Evidence";
  const secondary = Array.isArray(result?.secondary_frames)
    ? result.secondary_frames.filter(f => FRAMES.includes(f) && f !== "Insufficient Evidence").slice(0, 3)
    : [];

  let keywords = Array.isArray(result?.evidence_keywords) ? result.evidence_keywords.map(String).filter(Boolean).slice(0, 8) : [];
  while (keywords.length < 3) keywords.push("insufficient explicit evidence");

  return {
    dominant_frame: dominant,
    secondary_frames: secondary,
    scores: normalizedScores,
    evidence_keywords: keywords,
    explanation: String(result?.explanation || "The model did not provide a detailed explanation."),
    uncertainty: ["low", "medium", "high"].includes(result?.uncertainty) ? result.uncertainty : "high"
  };
}

function getOpenAIContent(data) {
  if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
  if (data?.output_text) return data.output_text;
  if (Array.isArray(data?.output)) {
    return data.output.flatMap(item => item.content || []).map(part => part.text || part.content || "").join("\n");
  }
  return "";
}

async function analyzeWithOpenAI(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured in Vercel Environment Variables.");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: buildUserPrompt(text) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "rhinoceros_reception_analysis",
          strict: true,
          schema: analysisSchema
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed with status ${response.status}`);
  }
  return normalizeResult(extractJson(getOpenAIContent(data)));
}

async function analyzeWithAnthropic(text) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured in Vercel Environment Variables.");

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1600,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: `${buildUserPrompt(text)}\n\nReturn JSON only. No markdown.` }]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Anthropic request failed with status ${response.status}`);
  }
  const textOut = Array.isArray(data.content)
    ? data.content.map(part => part.text || "").join("\n")
    : "";
  return normalizeResult(extractJson(textOut));
}

async function analyzeWithGemini(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured in Vercel Environment Variables.");

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{ text: `${systemPrompt}\n\n${buildUserPrompt(text)}\n\nReturn JSON only. No markdown.` }]
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini request failed with status ${response.status}`);
  }
  const textOut = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n") || "";
  return normalizeResult(extractJson(textOut));
}

export default async function handler(req, res) {
  if (req.method === "HEAD") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    return send(res, 405, { error: "Only POST requests are allowed." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const text = String(body.text || "").trim();
    const model = String(body.model || "gpt").toLowerCase();

    if (text.length < 50) {
      return send(res, 400, { error: "Text is too short. Please provide at least 50 characters." });
    }
    if (text.length > 8000) {
      return send(res, 400, { error: "Text is too long. Please use an excerpt under 8,000 characters." });
    }

    let result;
    if (model === "gpt") result = await analyzeWithOpenAI(text);
    else if (model === "claude") result = await analyzeWithAnthropic(text);
    else if (model === "gemini") result = await analyzeWithGemini(text);
    else return send(res, 400, { error: "Unsupported model. Use gpt, claude, or gemini." });

    return send(res, 200, result);
  } catch (error) {
    console.error(error);
    return send(res, 500, {
      error: "Live analysis failed.",
      detail: error.message
    });
  }
}

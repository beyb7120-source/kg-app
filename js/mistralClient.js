// ============================================================
// mistralClient.js — the ONLY place that talks to the network.
// Replaces geminiClient.js (same role in the pipeline: both
// stages call this exact function, only the prompt/schema differ).
//
// Mistral-specific realities this file has to handle that Gemini
// didn't:
//   1. No true schema-constrained output — only response_format:
//      {"type":"json_object"} which guarantees valid JSON, not a
//      specific shape. So the exact structure has to be spelled
//      out in the prompt (see stages/*.js), and we validate/clean
//      the result defensively rather than trusting the shape.
//   2. Free tier ("Experiment") is capped around 2 requests/minute.
//      This module paces calls itself so the two pipeline stages
//      never fire back-to-back and get 429'd.
// ============================================================

const BASE_URL = "https://api.mistral.ai/v1/chat/completions";

// 2 RPM = 1 request per 30s. Add a small safety margin.
const MIN_INTERVAL_MS = 31_000;
let lastCallAt = 0;

async function pace(onProgress) {
  const elapsed = Date.now() - lastCallAt;
  if (lastCallAt && elapsed < MIN_INTERVAL_MS) {
    const waitMs = MIN_INTERVAL_MS - elapsed;
    onProgress?.(`Pause de ${Math.ceil(waitMs / 1000)}s (limite Mistral free tier: 2 req/min)...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/** Strips ```json fences if the model adds them despite instructions not to. */
function sanitizeJson(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
}

/**
 * @param {Object} params
 * @param {string} params.apiKey
 * @param {string} params.model             - e.g. "mistral-large-latest"
 * @param {string} params.systemInstruction - rules for this call
 * @param {string} params.schemaExample     - literal JSON example the model must mirror
 * @param {string} params.userText
 * @param {Function} [params.onProgress]
 * @returns {Promise<Object>} parsed JSON
 */
export async function callMistral({ apiKey, model, systemInstruction, schemaExample, userText, onProgress }) {
  if (!apiKey) {
    throw new Error("Aucune clé API fournie. Colle ta clé Mistral dans le champ en haut.");
  }

  const fullSystemPrompt = `${systemInstruction}

Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant/après, sans balises markdown,
respectant EXACTEMENT cette structure (les clés doivent être identiques) :
${schemaExample}`;

  const body = {
    model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: fullSystemPrompt },
      { role: "user", content: userText },
    ],
  };

  await pace(onProgress);

  let res = await doFetch(apiKey, body);

  // One retry on 429: our own pacing should prevent this, but a
  // previous page session / manual re-run can still collide.
  if (res.status === 429) {
    onProgress?.("Limite atteinte (429) — nouvelle tentative dans 65s...");
    await new Promise((r) => setTimeout(r, 65_000));
    res = await doFetch(apiKey, body);
  }

  lastCallAt = Date.now();

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Erreur API Mistral (${res.status}) sur ${model} : ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Réponse vide de Mistral.");

  try {
    return JSON.parse(sanitizeJson(text));
  } catch {
    throw new Error("La réponse de Mistral n'était pas un JSON valide (pas de schema imposé côté API).");
  }
}

function doFetch(apiKey, body) {
  return fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }).catch((networkErr) => {
    throw new Error(`Impossible de joindre l'API Mistral (réseau). Détail: ${networkErr.message}`);
  });
}

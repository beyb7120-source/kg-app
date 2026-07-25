// ============================================================
// chatClient.js — on-demand Q&A about a single concept ("Demander
// à l'IA" button). Reuses mistralClient.js (the ONE network entry
// point in the app) instead of calling fetch() directly, so pacing/
// retry/error-handling stays centralized in a single place.
//
// Not part of STAGES in pipeline.js on purpose: this is a user-
// triggered side call, not a step of the automatic extraction run.
// ============================================================

import { callMistral } from "./mistralClient.js";
import { MODELS } from "./config.js";

function buildSystemInstruction(node, sectionText) {
  return `
Tu es un assistant pédagogique. Un·e étudiant·e consulte un graphe de concepts extrait
d'un cours et te pose une question sur UN concept précis de ce graphe.

CONTEXTE (ce que le graphe sait déjà sur ce concept) :
- Concept : "${node.label}"
- Définition extraite du cours : "${node.definition}"
- Passage source exact : "${node.sourceQuote}"
${sectionText ? `- Texte complet de la section source :\n"""${sectionText}"""` : ""}

RÈGLES :
1. Réponds en te basant en PRIORITÉ sur le contexte ci-dessus (c'est le cours réel de
   l'étudiant·e). Tu peux compléter avec tes connaissances générales UNIQUEMENT pour
   clarifier ou donner un exemple supplémentaire, jamais pour contredire le cours.
2. Si tu ajoutes une information qui ne vient PAS du texte source, dis-le clairement
   (ex : "en dehors de ton cours, on peut aussi noter que...").
3. Réponds dans la même langue que la question de l'étudiant·e.
4. Sois concis et pédagogique — va à l'essentiel, adapte-toi à un public étudiant qui
   découvre la notion.
`.trim();
}

const SCHEMA_EXAMPLE = JSON.stringify({ answer: "Réponse pédagogique concise ici." }, null, 2);

/**
 * @param {Object} params
 * @param {string} params.apiKey
 * @param {Object} params.node          — the node being discussed (label, definition, sourceQuote...)
 * @param {string} [params.sectionText] — full source section text, if available (better grounding)
 * @param {string} params.question
 * @param {Function} [params.onProgress]
 * @returns {Promise<string>} the answer text
 */
export async function askAboutConcept({ apiKey, node, sectionText, question, onProgress }) {
  const result = await callMistral({
    apiKey,
    model: MODELS.chat,
    systemInstruction: buildSystemInstruction(node, sectionText),
    schemaExample: SCHEMA_EXAMPLE,
    userText: question,
    onProgress,
  });

  if (typeof result.answer !== "string" || !result.answer.trim()) {
    throw new Error("Réponse vide du modèle.");
  }

  return result.answer.trim();
}

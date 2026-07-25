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

// ============================================================
// Général (aucun concept sélectionné) — "poser une question" sans
// être passé par un nœud du graphe. Contrairement à askAboutConcept,
// ce mode reçoit TOUT le texte source (sections de stage 1) et doit
// répondre EXCLUSIVEMENT à partir de ce texte, jamais "de sa tête".
// La réponse est découpée en segments, chacun optionnellement relié
// à une citation exacte + un id de section, pour permettre d'afficher
// un marqueur cliquable à côté de chaque phrase sourcée (l'utilisateur
// clique -> le passage s'affiche en surbrillance dans le panel source).
// ============================================================

function buildDocumentSystemInstruction(sectionsText) {
  return `
Tu es un assistant pédagogique. Un·e étudiant·e te pose une question sur un cours. Tu as
accès ci-dessous à L'INTÉGRALITÉ du texte source de ce cours, découpé en sections numérotées.

RÈGLES STRICTES, NON NÉGOCIABLES :
1. Réponds UNIQUEMENT à partir du texte source fourni ci-dessous. N'utilise JAMAIS tes
   connaissances générales pour ajouter une information, un exemple ou un fait qui ne s'y
   trouve pas explicitement.
2. Si la réponse (ou une partie de la réponse) ne se trouve pas dans le texte source, dis-le
   clairement plutôt que d'inventer ou de deviner.
3. Découpe ta réponse en plusieurs segments courts dans le tableau "answer". CHAQUE segment
   qui reprend une information du texte source DOIT avoir "sourceQuote" (un passage EXACT,
   copié mot pour mot du texte source, une phrase ou moins) et "sectionId" (l'id de la
   section — ex "s1" — d'où provient ce passage précis).
4. Les segments purement transitionnels ou stylistiques (ex: "De plus,", "En résumé,",
   "Concernant ta question,") qui ne portent aucune information factuelle peuvent avoir
   "sourceQuote" et "sectionId" à null.
5. Ne fusionne pas deux idées venant de sections différentes dans le même segment — un
   segment = une seule citation source (ou aucune).
6. Réponds dans la même langue que la question de l'étudiant·e.
7. Sois concis et pédagogique.

TEXTE SOURCE (sections) :
${sectionsText}
`.trim();
}

const SCHEMA_EXAMPLE_DOCUMENT = JSON.stringify(
  {
    answer: [
      {
        text: "Segment de la réponse, en texte brut.",
        sourceQuote: "passage exact copié du texte source, ou null si non sourcé",
        sectionId: "s1 ou null",
      },
    ],
  },
  null,
  2
);

/** Defensive validation: drops/repairs anything malformed rather than trusting the shape blindly. */
function validateSegments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((seg) => seg && typeof seg.text === "string" && seg.text.trim())
    .map((seg) => ({
      text: seg.text.trim(),
      sourceQuote: typeof seg.sourceQuote === "string" && seg.sourceQuote.trim() ? seg.sourceQuote.trim() : null,
      sectionId: typeof seg.sectionId === "string" && seg.sectionId.trim() ? seg.sectionId.trim() : null,
    }))
    .map((seg) => (seg.sourceQuote && !seg.sectionId ? { ...seg, sourceQuote: null } : seg));
}

/**
 * @param {Object} params
 * @param {string} params.apiKey
 * @param {{id:string, heading:string, text:string}[]} params.sections — full stage-1 output
 * @param {string} params.question
 * @param {Function} [params.onProgress]
 * @returns {Promise<{text:string, sourceQuote:string|null, sectionId:string|null}[]>}
 */
export async function askAboutDocument({ apiKey, sections, question, onProgress }) {
  if (!Array.isArray(sections) || !sections.length) {
    throw new Error("Aucun texte source disponible pour répondre à cette question.");
  }

  const sectionsText = sections.map((s) => `### Section ${s.id} — ${s.heading}\n${s.text}`).join("\n\n");

  const result = await callMistral({
    apiKey,
    model: MODELS.chat,
    systemInstruction: buildDocumentSystemInstruction(sectionsText),
    schemaExample: SCHEMA_EXAMPLE_DOCUMENT,
    userText: question,
    onProgress,
  });

  const segments = validateSegments(result.answer);
  if (!segments.length) {
    throw new Error("Réponse vide du modèle.");
  }

  return segments;
}
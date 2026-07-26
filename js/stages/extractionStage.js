// ============================================================
// stages/extractionStage.js — STAGE 1 of the pipeline.
//
// SAME MOLD every stage follows:
//   input  : whatever the previous element produced
//   output : a plain object, ready to be the next element's input
//   run()  : the only exported function — orchestrator never
//            touches anything else in this file
//
// Job of this stage, and ONLY this job: turn messy raw page text
// into clean, well-segmented sections. It does NOT identify
// concepts or relations — that is stage 2's job. Keeping the two
// separated is what keeps each model's instructions simple and
// each stage independently testable.
// ============================================================

import { callMistral } from "../mistralClient.js";
import { MODELS } from "../config.js";

const SYSTEM_INSTRUCTION = `
Tu es un module de LECTURE et de STRUCTURATION de texte académique. Rien d'autre.

RÈGLES STRICTES :
1. Ta seule tâche est de nettoyer et segmenter le texte fourni en sections cohérentes.
   Tu N'IDENTIFIES PAS de concepts, tu NE CRÉES PAS de relations. Ce n'est pas ton rôle.
2. Ne reformule JAMAIS le contenu scientifique. Ne résume pas. Ne simplifie pas.
   Corrige uniquement : mots coupés par la mise en page, artefacts d'extraction PDF,
   notation mathématique mal encodée (rétablis-la en LaTeX si c'est clairement une formule).
3. N'AJOUTE aucune information, exemple ou explication qui ne serait pas déjà dans le texte source.
4. Préserve la langue originale du document. Ne traduis rien.
5. Découpe en sections logiques (une section = une idée/sous-partie cohérente, pas forcément
   une page). Donne à chaque section un id court stable (ex: "s1", "s2") et un titre bref
   qui reflète fidèlement son contenu.
6. Si une portion de texte est illisible ou n'a clairement aucun sens (artefact d'extraction),
   ignore-la plutôt que d'essayer de la "réparer" en devinant.
`.trim();

// Mistral's JSON mode guarantees valid JSON but not this exact shape,
// so the shape has to be taught by example inside the prompt itself.
const SCHEMA_EXAMPLE = JSON.stringify(
  {
    sections: [
      { id: "s1", heading: "Titre bref et fidèle de la section", text: "Texte nettoyé de la section." },
    ],
  },
  null,
  2
);

/** Drops anything malformed instead of trusting the model kept the shape. */
function validateSections(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s) => s && typeof s.id === "string" && typeof s.heading === "string" && typeof s.text === "string"
  );
}

// Heuristique conservative : un document "normal" (quelques pages de
// cours) tient largement dans une seule requête. Au-delà, on risque de
// dépasser le budget de contexte utile de Mistral Large une fois le
// system prompt + schema example ajoutés — mieux vaut découper que
// risquer une réponse tronquée ou un déni silencieux de qualité.
const CHUNK_CHAR_LIMIT = 12000;

/** Regroupe les pages en chunks dont le texte cumulé reste sous CHUNK_CHAR_LIMIT.
 *  Ne découpe jamais une page en deux — si une page seule dépasse déjà la
 *  limite, elle part seule dans son propre chunk (cas limite accepté). */
function chunkPages(pages) {
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const page of pages) {
    if (current.length && currentLen + page.text.length > CHUNK_CHAR_LIMIT) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(page);
    currentLen += page.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Un seul appel Mistral sur un chunk de pages ; renumérote les ids de
 *  sections avec `idOffset` pour rester uniques sur l'ensemble du document. */
async function runChunk(pages, context, idOffset) {
  const rawText = pages.map((p) => `[page ${p.pageNumber}]\n${p.text}`).join("\n\n");

  if (rawText.trim().length < 20) {
    throw new Error("Le texte source est vide ou trop court pour être traité.");
  }

  const result = await callMistral({
    apiKey: context.apiKey,
    model: MODELS.extraction,
    systemInstruction: SYSTEM_INSTRUCTION,
    schemaExample: SCHEMA_EXAMPLE,
    userText: rawText,
    onProgress: context.onProgress,
  });

  const sections = validateSections(result.sections);
  if (!sections.length) {
    throw new Error("Aucune section valide n'a pu être extraite du document.");
  }

  return sections.map((s, i) => ({ ...s, id: `s${idOffset + i + 1}` }));
}

/**
 * @param {{pageNumber:number, text:string}[]} pages  — output of pdfReader
 * @param {{apiKey:string, onProgress?:Function}} context
 * @returns {Promise<{id:string, heading:string, text:string}[]>}
 */
export async function run(pages, context) {
  const totalLength = pages.reduce((sum, p) => sum + p.text.length, 0);

  if (totalLength <= CHUNK_CHAR_LIMIT) {
    context.onProgress?.("Lecture et structuration du texte source...");
    return runChunk(pages, context, 0);
  }

  // Document long : découpage en plusieurs appels séquentiels. Le pacing
  // (31s entre requêtes Mistral) est déjà géré globalement par
  // mistralClient.js, donc ces appels successifs restent conformes au
  // rate limit du free tier automatiquement, sans rien coder ici.
  const chunks = chunkPages(pages);
  const allSections = [];

  for (let i = 0; i < chunks.length; i++) {
    context.onProgress?.(`Lecture et structuration du texte source (partie ${i + 1}/${chunks.length})...`);
    const sections = await runChunk(chunks[i], context, allSections.length);
    allSections.push(...sections);
  }

  return allSections;
}

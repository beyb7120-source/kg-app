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

/**
 * @param {{pageNumber:number, text:string}[]} pages  — output of pdfReader
 * @param {{apiKey:string, onProgress?:Function}} context
 * @returns {Promise<{id:string, heading:string, text:string}[]>}
 */
export async function run(pages, context) {
  const rawText = pages.map((p) => `[page ${p.pageNumber}]\n${p.text}`).join("\n\n");

  if (rawText.trim().length < 20) {
    throw new Error("Le texte source est vide ou trop court pour être traité.");
  }

  context.onProgress?.("Lecture et structuration du texte source...");

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

  return sections;
}

// ============================================================
// stages/graphStage.js — STAGE 2 of the pipeline.
//
// Same mold as stage 1: run(input, context) -> output.
// Input here is stage 1's output (sections[]) — this stage never
// sees raw PDF pages, it only ever sees clean structured text.
//
// This is the "brain" of the app: it identifies concepts (nodes)
// and typed relations (edges) between them. Every rule here exists
// because of a concrete failure mode discussed for this project:
// hallucinated relations, invented facts from the model's training
// data, ambiguous/bidirectional edges polluting the graph, etc.
// ============================================================

import { callMistral } from "../mistralClient.js";
import { MODELS, RELATION_TYPES, RELATION_KEYS } from "../config.js";

function buildSystemInstruction() {
  const vocabList = RELATION_TYPES.map((r) => `  - "${r.key}" : ${r.label}`).join("\n");

  return `
Tu es un module d'EXTRACTION DE GRAPHE DE CONNAISSANCES à partir d'un document académique.

RÈGLES STRICTES, NON NÉGOCIABLES :

1. VOCABULAIRE FERMÉ — le champ "type" de chaque relation doit être EXACTEMENT une de ces
   valeurs, rien d'autre :
${vocabList}

2. EXTRACTION UNIQUEMENT — tu extrais ce qui est ÉCRIT ou clairement IMPLIQUÉ dans le texte
   fourni. Tu N'UTILISES JAMAIS tes connaissances générales du domaine pour ajouter un concept
   ou une relation qui ne provient pas de CE texte précis. Si un lien te semble "vrai en
   général" mais n'est pas soutenu par le texte fourni, tu ne l'inclus PAS.

3. GROUNDING OBLIGATOIRE — pour CHAQUE nœud et CHAQUE relation, "sourceQuote" doit être un
   passage court (une phrase ou moins) copié du texte source qui justifie ton extraction.
   Si tu ne peux pas citer un passage précis, n'extrais pas cet élément.

4. REJETTE L'AMBIGU — si une relation entre deux concepts est bidirectionnelle, vague, ou si
   tu hésites sur le sens (A→B ou B→A), NE L'INCLUS PAS DU TOUT plutôt que de deviner.
   Un graphe incomplet mais fiable vaut mieux qu'un graphe complet mais faux.

5. CONFIANCE HONNÊTE — le champ "confidence" (0 à 1) doit refléter ta certitude réelle que
   cette relation est explicitement soutenue par le texte. Ne mets pas systématiquement des
   scores élevés.

6. Ne crée pas de doublons conceptuels : si "débit volumique" et "débit" désignent la même
   chose dans le texte, un seul nœud.

7. Préserve la langue originale du document dans "label" et "definition". Ne traduis pas.

8. "definition" doit être courte (1-2 phrases), basée strictement sur le texte, jamais une
   définition générique tirée de tes connaissances générales.
`.trim();
}

// Mistral JSON mode guarantees valid JSON, not a specific shape or enum —
// so the exact structure AND the closed vocabulary have to be taught by
// example, and enforced again ourselves once the response comes back
// (see validateGraph below). This is the direct consequence of losing
// Gemini's responseSchema/enum enforcement.
const SCHEMA_EXAMPLE = JSON.stringify(
  {
    nodes: [
      {
        id: "n1",
        label: "Nom du concept (langue du document)",
        definition: "Définition courte, basée strictement sur le texte source",
        sourceQuote: "passage exact copié du texte source",
        sourceSectionId: "s1",
      },
    ],
    edges: [
      {
        id: "e1",
        source: "n1",
        target: "n2",
        type: `un parmi: ${RELATION_KEYS.join(", ")}`,
        sourceQuote: "passage exact copié du texte source",
        confidence: 0.85,
      },
    ],
  },
  null,
  2
);

/** Defensive validation: drops anything malformed rather than crashing the renderer. */
function validateGraph(raw) {
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).filter(
    (n) =>
      n &&
      typeof n.id === "string" &&
      typeof n.label === "string" &&
      typeof n.definition === "string" &&
      typeof n.sourceQuote === "string"
  );

  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges = (Array.isArray(raw.edges) ? raw.edges : []).filter(
    (e) =>
      e &&
      typeof e.id === "string" &&
      nodeIds.has(e.source) &&
      nodeIds.has(e.target) &&
      RELATION_KEYS.includes(e.type) &&
      typeof e.confidence === "number" &&
      e.confidence >= 0 &&
      e.confidence <= 1
  );

  return { nodes, edges };
}

/**
 * @param {{id:string, heading:string, text:string}[]} sections — stage 1 output
 * @param {{apiKey:string, onProgress?:Function}} context
 * @returns {Promise<{nodes:Object[], edges:Object[]}>}
 */
export async function run(sections, context) {
  const userText = sections
    .map((s) => `### Section ${s.id} — ${s.heading}\n${s.text}`)
    .join("\n\n");

  context.onProgress?.("Extraction des concepts et des relations...");

  const result = await callMistral({
    apiKey: context.apiKey,
    model: MODELS.reasoning,
    systemInstruction: buildSystemInstruction(),
    schemaExample: SCHEMA_EXAMPLE,
    userText,
    onProgress: context.onProgress,
  });

  const graph = validateGraph(result);
  if (!graph.nodes.length) {
    throw new Error("Aucun concept valide n'a pu être extrait (vérifie la clé API et réessaie).");
  }

  return graph;
}

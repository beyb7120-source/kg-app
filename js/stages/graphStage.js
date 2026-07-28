// ============================================================
// stages/graphStage.js — STAGE 2 (Two-Stage Processing)
// ============================================================

import { callMistral } from "../mistralClient.js";
import { MODELS, RELATION_TYPES, RELATION_KEYS } from "../config.js";

// ------------------------------------------------------------
// PHASE 1 : EXTRACTION DES NOEUDS (CONCEPTS)
// ------------------------------------------------------------
function buildNodesSystemInstruction() {
  return `
Tu es un module d'EXTRACTION DE CONCEPTS à partir d'un document académique.
Ta SEULE tâche est d'identifier les concepts clés mentionnés dans le texte.
Tu NE DOIS PAS extraire de relations pour le moment.

RÈGLES STRICTES :
1. EXTRACTION UNIQUEMENT — extrais ce qui est ÉCRIT dans le texte. N'invente rien.
2. GROUNDING OBLIGATOIRE — "sourceQuote" doit être une phrase exacte du texte source.
3. "definition" doit être courte (1-2 phrases), basée strictement sur le texte.
4. Préserve la langue originale du document.
5. Ne crée pas de doublons conceptuels.
`.trim();
}

const SCHEMA_NODES = JSON.stringify({
  nodes: [
    {
      id: "n1",
      label: "Nom du concept",
      definition: "Définition stricte tirée du texte",
      sourceQuote: "passage exact copié du texte source",
      sourceSectionId: "s1"
    }
  ]
}, null, 2);

// ------------------------------------------------------------
// PHASE 2 : EXTRACTION DES RELATIONS (EDGES)
// ------------------------------------------------------------
function buildEdgesSystemInstruction() {
  const vocabList = RELATION_TYPES.map((r) => ` - "${r.key}" : ${r.label}`).join("\n");
  
  return `
Tu es un module d'EXTRACTION DE RELATIONS. Tu vas recevoir un texte académique ET 
une liste stricte de concepts (nœuds) qui ont déjà été extraits de ce texte.
Ta SEULE tâche est de trouver les liens logiques entre CES concepts spécifiques.

RÈGLES STRICTES :
1. VOCABULAIRE FERMÉ — le type de relation doit être EXACTEMENT :
${vocabList}
2. UTILISE UNIQUEMENT LES IDs FOURNIS — la "source" et la "target" doivent correspondre aux IDs des concepts fournis.
3. GROUNDING OBLIGATOIRE — "sourceQuote" doit être le passage exact qui prouve ce lien.
4. REJETTE L'AMBIGU — en cas de doute sur le sens de la relation, ne l'inclus pas.
5. CONFIANCE — "confidence" (0 à 1) reflète ta certitude.
`.trim();
}

const SCHEMA_EDGES = JSON.stringify({
  edges: [
    {
      id: "e1",
      source: "ID_du_concept_source (ex: n1)",
      target: "ID_du_concept_cible (ex: n2)",
      type: `un parmi: ${RELATION_KEYS.join(", ")}`,
      sourceQuote: "passage exact copié du texte source",
      confidence: 0.85
    }
  ]
}, null, 2);

// ------------------------------------------------------------
// VALIDATION
// ------------------------------------------------------------
function validateNodes(raw) {
  return (Array.isArray(raw?.nodes) ? raw.nodes : []).filter(
    (n) => n && typeof n.id === "string" && typeof n.label === "string" && typeof n.sourceQuote === "string"
  );
}

function validateEdges(raw, validNodeIds) {
  return (Array.isArray(raw?.edges) ? raw.edges : []).filter(
    (e) => e && typeof e.id === "string" && validNodeIds.has(e.source) && validNodeIds.has(e.target) && RELATION_KEYS.includes(e.type)
  );
}

// ------------------------------------------------------------
// ORCHESTRATION
// ------------------------------------------------------------
export async function run(sections, context) {
  const userText = sections.map((s) => `### Section ${s.id} — ${s.heading}\n${s.text}`).join("\n\n");

  // --- ÉTAPE 1 : Extraire les concepts ---
  context.onProgress?.("Étape 1/2 : Extraction des concepts (Nodes)...");
  const nodesResult = await callMistral({
    apiKey: context.apiKey,
    model: MODELS.reasoning,
    systemInstruction: buildNodesSystemInstruction(),
    schemaExample: SCHEMA_NODES,
    userText,
    onProgress: context.onProgress,
  });

  const nodes = validateNodes(nodesResult);
  if (!nodes.length) throw new Error("Aucun concept valide n'a pu être extrait.");

  // --- ÉTAPE 2 : Extraire les relations ---
  context.onProgress?.("Étape 2/2 : Analyse des liens logiques (Edges)...");
  
  // On fournit au modèle le texte ET les concepts trouvés à l'étape 1
  const edgesUserText = `TEXTE SOURCE :\n${userText}\n\nCONCEPTS EXTRAITS :\n${JSON.stringify(nodes, null, 2)}`;
  
  const edgesResult = await callMistral({
    apiKey: context.apiKey,
    model: MODELS.reasoning,
    systemInstruction: buildEdgesSystemInstruction(),
    schemaExample: SCHEMA_EDGES,
    userText: edgesUserText,
    onProgress: context.onProgress,
  });

  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = validateEdges(edgesResult, nodeIds);

  return { nodes, edges };
}
// ============================================================
// pipeline.js — the only file that knows the ORDER of stages.
// Each stage is called through the exact same shape:
//     const output = await stage.run(input, context)
// so adding/reordering/removing a stage never requires touching
// any stage's internals, only this list.
// ============================================================

import { run as runExtraction } from "./stages/extractionStage.js";
import { run as runGraphExtraction } from "./stages/graphStage.js";

const STAGES = [
  { name: "extraction", run: runExtraction },
  { name: "graph", run: runGraphExtraction },
];

/**
 * @param {{pageNumber:number, text:string}[]} pages — first input, from pdfReader
 * @param {{apiKey:string, onProgress?:Function}} context
 * @returns {Promise<Object>} every stage's output, keyed by stage name —
 *   currently `{ extraction: {id,heading,text}[], graph: {nodes,edges} }`.
 *   Each stage still only ever sees the PREVIOUS stage's output as its
 *   input (same mold as before) — this object is purely an accumulator
 *   for callers downstream of the pipeline (app.js) that need more than
 *   just the final result, e.g. stage 1's sections for "aller à la
 *   source" and the concept chat, alongside stage 2's graph.
 */
export async function execute(pages, context) {
  let data = pages;
  const results = {};

  for (const stage of STAGES) {
    try {
      data = await stage.run(data, context);
    } catch (err) {
      throw new Error(`[étape "${stage.name}"] ${err.message}`);
    }
    results[stage.name] = data;
  }

  // If you append a stage after "graph" in STAGES, its output simply
  // shows up as a new key here — nothing else in this file changes.
  return results;
}

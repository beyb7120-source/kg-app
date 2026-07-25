// ============================================================
// learningPath.js — pure graph algorithm, NO network call.
//
// Deliberately NOT another Mistral call: the order is fully
// determined by the "prerequisite_of" edges the model already
// extracted (with their own grounding + confidence score). Asking
// the model again would risk a NEW hallucinated order, cost another
// ~31s paced call on the free tier, and contradict the project's
// own grounding philosophy (see README "Réglages de fiabilité").
// Kahn's algorithm gives a deterministic, explainable order for
// free, straight from data the pipeline already produced.
// ============================================================

/**
 * @param {{nodes:Object[], edges:Object[]}} graphData
 * @param {{minConfidence?:number}} [opts]
 * @returns {{order:Object[], cycles:string[][]}}
 *   order  — nodes sorted so every prerequisite comes before what
 *            depends on it. Nodes with no prerequisite edges at all
 *            appear first, in their original order.
 *   cycles — groups of node ids that couldn't be strictly ordered
 *            because they form a prerequisite cycle (still included
 *            in `order`, appended at the end, so nothing is dropped).
 */
export function computeLearningPath(graphData, opts = {}) {
  const minConfidence = opts.minConfidence ?? 0;

  const prereqEdges = graphData.edges.filter(
    (e) => e.type === "prerequisite_of" && e.confidence >= minConfidence
  );

  const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]));
  const dependents = new Map(graphData.nodes.map((n) => [n.id, []]));
  const indegree = new Map(graphData.nodes.map((n) => [n.id, 0]));

  for (const edge of prereqEdges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    dependents.get(edge.source).push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  // Kahn's algorithm, stable: nodes become "ready" in their original order.
  const queue = graphData.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const order = [];
  const remaining = new Map(indegree);

  while (queue.length) {
    const id = queue.shift();
    order.push(nodeById.get(id));
    for (const depId of dependents.get(id) ?? []) {
      remaining.set(depId, remaining.get(depId) - 1);
      if (remaining.get(depId) === 0) queue.push(depId);
    }
  }

  // Anything left has indegree > 0 forever => part of a prerequisite cycle.
  const orderedIds = new Set(order.map((n) => n.id));
  const cycleNodes = graphData.nodes.filter((n) => !orderedIds.has(n.id));

  return {
    order: [...order, ...cycleNodes],
    cycles: cycleNodes.length ? [cycleNodes.map((n) => n.id)] : [],
  };
}

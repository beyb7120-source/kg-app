// ============================================================
// graphQueries.js — pure derived views over {nodes, edges}.
// Never mutates graphData, never touches the DOM or the network.
// Takes the EXACT SAME graph mold produced by graphStage.js and
// only reads from it — this is where "node detail" aggregation
// logic lives, kept out of app.js / graphRenderer.js on purpose
// so each file keeps a single job.
// ============================================================

import { RELATION_TYPES } from "./config.js";

const relationByKey = Object.fromEntries(RELATION_TYPES.map((r) => [r.key, r]));

/**
 * Groups every edge touching `nodeId` by relation type and direction,
 * resolving the neighbour node object so the caller never has to
 * cross-reference `graphData.nodes` itself.
 *
 * @param {string} nodeId
 * @param {{nodes:Object[], edges:Object[]}} graphData
 * @returns {{
 *   outgoing: {type:string, label:string, color:string, items:{edge:Object, node:Object}[]}[],
 *   incoming: {type:string, label:string, color:string, items:{edge:Object, node:Object}[]}[]
 * }}
 */
export function getNodeRelations(nodeId, graphData) {
  const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]));

  const outgoingEdges = graphData.edges.filter((e) => e.source === nodeId);
  const incomingEdges = graphData.edges.filter((e) => e.target === nodeId);

  return {
    outgoing: groupByType(outgoingEdges, "target", nodeById),
    incoming: groupByType(incomingEdges, "source", nodeById),
  };
}

function groupByType(edges, neighbourField, nodeById) {
  const byType = new Map();

  for (const edge of edges) {
    const neighbour = nodeById.get(edge[neighbourField]);
    if (!neighbour) continue; // defensive: validateGraph should prevent this, but never trust blindly

    if (!byType.has(edge.type)) byType.set(edge.type, []);
    byType.get(edge.type).push({ edge, node: neighbour });
  }

  return Array.from(byType.entries()).map(([type, items]) => ({
    type,
    label: relationByKey[type]?.label ?? type,
    color: relationByKey[type]?.color ?? "#93A9C2",
    items,
  }));
}

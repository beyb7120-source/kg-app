// ============================================================
// graphRenderer.js — turns {nodes, edges} into an interactive
// Cytoscape graph. This module never talks to Gemini and never
// mutates the data — it only reads it and reads the current
// confidence threshold from the UI.
// ============================================================

import { RELATION_TYPES } from "./config.js";

/* global cytoscape */

const relationByKey = Object.fromEntries(RELATION_TYPES.map((r) => [r.key, r]));

let cy = null;

/**
 * @param {{nodes:Object[], edges:Object[]}} graphData — stage 2 output
 * @param {HTMLElement} container
 * @param {{onNodeClick:Function, onEdgeClick:Function, confidenceThreshold:number}} opts
 */
export function render(graphData, container, opts) {
  const visibleEdges = graphData.edges.filter((e) => e.confidence >= opts.confidenceThreshold);
  const usedNodeIds = new Set(visibleEdges.flatMap((e) => [e.source, e.target]));

  // Keep nodes even if they lost all edges below threshold, so the
  // user can raise/lower the slider without concepts disappearing
  // entirely — but dim them so the graph stays readable.
  const elements = [
    ...graphData.nodes.map((n) => ({
      data: { id: n.id, label: n.label, ...n },
      classes: usedNodeIds.has(n.id) ? "" : "faded",
    })),
    ...visibleEdges.map((e) => ({
      data: { id: e.id, source: e.source, target: e.target, ...e },
    })),
  ];

  cy = cytoscape({
    container,
    elements,
    style: buildStylesheet(),
    layout: { name: "cose", animate: true, animationDuration: 400, padding: 40 },
    wheelSensitivity: 0.25,
    // Cytoscape gère le pan/pinch-to-zoom tactile nativement (pas besoin
    // de lib externe) — on le rend explicite + on borne le zoom pour que
    // le graphe reste manipulable sur petit écran (mobile/tablette).
    userZoomingEnabled: true,
    userPanningEnabled: true,
    boxSelectionEnabled: false,
    minZoom: 0.2,
    maxZoom: 3,
  });

  cy.on("tap", "node", (evt) => opts.onNodeClick(evt.target.data()));
  cy.on("tap", "edge", (evt) => opts.onEdgeClick(evt.target.data()));

  // Handed back so callers can reuse it downstream (PDF export,
  // programmatic node selection from the learning-path modal, resize
  // on panel drag...) without this module needing to know about any
  // of those use cases itself.
  return cy;
}

/** Re-filter an already-rendered graph without re-running layout from scratch. */
export function updateThreshold(graphData, confidenceThreshold, container, opts) {
  return render(graphData, container, { ...opts, confidenceThreshold });
}

function buildStylesheet() {
  const edgeStyles = RELATION_TYPES.map((r) => ({
    selector: `edge[type = "${r.key}"]`,
    style: {
      "line-color": r.color,
      "target-arrow-color": r.color,
      "target-arrow-shape": r.arrow,
      "line-style": r.lineStyle,
      width: 2,
      // هاد 3 الأسطر هما اللي كيخليو الخطوط منحنية ومفرقة على بعضياتها
      "curve-style": "unbundled-bezier",
      "control-point-distances": 40,
      "control-point-weights": 0.5,
    },
  }));

  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "background-color": "#163654",
        "border-width": 2,
        "border-color": "#E8934A",
        color: "#EAF1F8",
        "font-family": "IBM Plex Mono, monospace",
        "font-size": 11,
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        "text-max-width": "90px",
        shape: "round-rectangle",
        width: "label",
        height: "label",
        padding: "10px",
      },
    },
    { selector: "node.faded", style: { opacity: 0.25 } },
    { selector: ".legend-dim", style: { opacity: 0.12 } },
    { selector: "node.legend-highlight", style: { "border-width": 3, "border-color": "#e8934a" } },
    { selector: "edge.legend-highlight", style: { width: 3.5, "z-compound-depth": "top" } },
    ...edgeStyles,
  ];
}
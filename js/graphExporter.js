// ============================================================
// graphExporter.js — turns the currently rendered graph into a
// downloadable PDF. Reads the live Cytoscape instance (image
// export) + graphData (title/counts) — never re-fetches or
// re-computes anything, purely a render-to-file step. No network,
// no API key needed: this is a client-side image → PDF export.
// ============================================================

/* global jspdf */

/**
 * @param {Object} cy — live Cytoscape instance (as returned by graphRenderer.render())
 * @param {{nodes:Object[], edges:Object[]}} graphData
 * @param {{title?:string}} [meta]
 * @returns {Promise<void>}
 */
export async function exportGraphToPdf(cy, graphData, meta = {}) {
  if (!cy) throw new Error("Aucun graphe à exporter — lance d'abord une extraction.");
  if (typeof jspdf === "undefined") throw new Error("La librairie jsPDF ne s'est pas chargée.");

  const title = meta.title || "Graphe de concepts";
  const imageData = cy.png({ full: true, scale: 2, bg: "#0f2a44" });
  const img = await loadImage(imageData);

  const { jsPDF } = jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFillColor(15, 42, 68);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  doc.setTextColor(234, 241, 248);
  doc.setFontSize(14);
  doc.text(title, 24, 28);

  doc.setFontSize(9);
  doc.setTextColor(147, 169, 194);
  doc.text(`${graphData.nodes.length} concepts — ${graphData.edges.length} relations`, 24, 42);

  const margin = 24;
  const topOffset = 60;
  const availW = pageWidth - margin * 2;
  const availH = pageHeight - topOffset - margin;
  const ratio = Math.min(availW / img.width, availH / img.height, 1);
  const w = img.width * ratio;
  const h = img.height * ratio;

  doc.addImage(imageData, "PNG", (pageWidth - w) / 2, topOffset, w, h);
  doc.save(`${title.replace(/\s+/g, "_")}.pdf`);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Impossible de préparer l'image du graphe."));
    img.src = src;
  });
}

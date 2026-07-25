// ============================================================
// sourceView.js — pure helpers to locate & highlight a quoted
// passage inside the sections produced by extractionStage.js.
// Never touches the DOM: returns plain data, app.js renders it.
// This is what makes "aller à la source" work for both nodes
// (which know their sourceSectionId) and edges (which currently
// don't carry one in the graph schema — see findSectionByQuote).
// ============================================================

/**
 * @param {{id:string, heading:string, text:string}[]} sections
 * @param {string} sectionId
 * @returns {{id:string, heading:string, text:string}|null}
 */
export function findSection(sections, sectionId) {
  if (!sections || !sectionId) return null;
  return sections.find((s) => s.id === sectionId) ?? null;
}

/**
 * Fallback for callers that only have a quote, not a sectionId
 * (edges have no sourceSectionId in the current graph schema) —
 * searches every section for the quote so "aller à la source"
 * still works for relations, not just concepts.
 */
export function findSectionByQuote(sections, quote) {
  if (!sections || !quote) return null;
  const needle = normalize(quote);
  if (!needle) return null;
  return sections.find((s) => normalize(s.text).includes(needle)) ?? null;
}

/**
 * Splits a section's text into plain / highlighted chunks around
 * the first occurrence of `quote`. Whitespace-tolerant because
 * pdf.js text extraction and the model's copy of the quote don't
 * always collapse spaces identically.
 *
 * @returns {{chunks:{text:string, highlight:boolean}[], found:boolean}}
 */
export function highlightQuote(sectionText, quote) {
  if (!quote || !quote.trim()) {
    return { chunks: [{ text: sectionText, highlight: false }], found: false };
  }

  const pattern = escapeRegExp(quote.trim()).replace(/\s+/g, "\\s+");
  let match;
  try {
    match = sectionText.match(new RegExp(pattern, "i"));
  } catch {
    match = null; // pathological quote (e.g. only symbols) — fall back to no highlight
  }

  if (!match) {
    return { chunks: [{ text: sectionText, highlight: false }], found: false };
  }

  const start = match.index;
  const end = start + match[0].length;

  return {
    found: true,
    chunks: [
      { text: sectionText.slice(0, start), highlight: false },
      { text: sectionText.slice(start, end), highlight: true },
      { text: sectionText.slice(end), highlight: false },
    ],
  };
}

function normalize(str) {
  return (str ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

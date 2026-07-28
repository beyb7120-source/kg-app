/* // ============================================================
// pdfReader.js — turns a File (PDF) into raw page text.
// Scope note: this handles born-digital PDFs (real text layer).
// Scanned/handwritten pages are OUT of scope for this MVP —
// see README.md for why, and how to extend it with a vision call.
// ============================================================

// pdfjsLib is loaded globally via the <script> tag in index.html.
 


export async function extractPdfPages(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const pages = [];
  let emptyPageCount = 0;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ").trim();

    if (text.length < 20) emptyPageCount++;
    pages.push({ pageNumber: i, text });
  }

  // If most pages came back near-empty, this PDF has no real text
  // layer (it's scanned images) — tell the user clearly instead of
  // silently sending near-nothing to the model.
  if (pdf.numPages > 0 && emptyPageCount / pdf.numPages > 0.6) {
    throw new Error(
      "Ce PDF semble être des images scannées (pas de texte extractible). " +
        "Cette version ne gère que les PDF numériques natifs. " +
        "Colle le texte manuellement, ou vois README.md pour ajouter un appel vision."
    );
  }

  return pages;
}

export function wrapPastedText(rawText) {
  return [{ pageNumber: 1, text: rawText.trim() }];
}
 */
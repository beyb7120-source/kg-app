// ============================================================
// sourceExtractor.js — Multi-source Data Ingestion
// Gère l'extraction de texte depuis PDF, Drive, Images, et Web.
// ============================================================

/* global pdfjsLib, Tesseract */

// --- PDF (Fichiers locaux) ---
export async function extractPdfPages(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ").trim();
    if (text.length > 20) pages.push({ pageNumber: i, text });
  }
  return pages;
}

// --- Images (OCR avec Tesseract.js) ---
export async function extractImageText(file) {
  if (typeof Tesseract === "undefined") throw new Error("Tesseract.js n'est pas chargé.");
  const result = await Tesseract.recognize(file, 'fra+eng'); // Support Français et Anglais
  return [{ pageNumber: 1, text: result.data.text.trim() }];
}

// --- Sites Web (Scraping via un Proxy public) ---
export async function extractWebsiteText(url) {
  try {
    // On utilise allorigins pour contourner les blocages CORS côté navigateur
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Erreur réseau.");
    const data = await response.json();
    
    // Nettoyage de l'HTML pour garder que le texte lisible
    const parser = new DOMParser();
    const doc = parser.parseFromString(data.contents, 'text/html');
    const text = doc.body.innerText.replace(/\s+/g, ' ').trim();
    return [{ pageNumber: 1, text: text.substring(0, 50000) }]; // Limite pour éviter les plantages
  } catch (error) {
    throw new Error(`Impossible de lire le site : ${url}`);
  }
}

// --- Google Drive (Exportation de document) ---
export async function extractDriveText(docData, oauthToken) {
  // Si c'est un Google Doc, on l'exporte en texte brut.
  if (docData.mimeType === "application/vnd.google-apps.document") {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${docData.id}/export?mimeType=text/plain`, {
      headers: { Authorization: `Bearer ${oauthToken}` }
    });
    const text = await response.text();
    return [{ pageNumber: 1, text: text.trim() }];
  } else {
    throw new Error("Seuls les Google Docs sont supportés pour le moment (pas de PDF Drive).");
  }
}

// --- Texte collé ---
export function wrapPastedText(rawText) {
  return [{ pageNumber: 1, text: rawText.trim() }];
}
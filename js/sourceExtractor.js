// ============================================================
// sourceExtractor.js — Multi-source Data Ingestion (FIXED)
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
  const result = await Tesseract.recognize(file, 'fra+eng');
  return [{ pageNumber: 1, text: result.data.text.trim() }];
}

// --- Sites Web & YouTube (CORRIGÉ) ---
export async function extractWebsiteText(url) {
  try {
    // 1. حماية خاصة بيوتيوب (مستحيل قراءته عبر HTML بسيط)
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      throw new Error("Impossible d'extraire directement depuis YouTube (protection client-side). Veuillez copier/coller le texte (Transcript) manuellement.");
    }

    // 2. محاولة قراءة المواقع العادية
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl);
    
    // إيلا البروكسي طاح بحال (408 Timeout)
    if (!response.ok) throw new Error(`Le proxy a retourné une erreur (${response.status})`);
    
    const data = await response.json();
    if (!data.contents) throw new Error("Le site a bloqué la lecture ou le contenu est vide.");

    const parser = new DOMParser();
    const doc = parser.parseFromString(data.contents, 'text/html');
    const text = doc.body.innerText.replace(/\s+/g, ' ').trim();
    
    if (text.length < 50) {
      throw new Error("Le texte extrait est trop court (le site bloque peut-être le scraping).");
    }

    return [{ pageNumber: 1, text: text.substring(0, 50000) }];
  } catch (error) {
    throw new Error(`Impossible de lire le lien: ${error.message}`);
  }
}

// --- Google Drive (CORRIGÉ) ---
export async function extractDriveText(docData, oauthToken) {
  if (docData.mimeType === "application/vnd.google-apps.document") {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${docData.id}/export?mimeType=text/plain`, {
      headers: { Authorization: `Bearer ${oauthToken}` }
    });
    
    // 🛑 هادي هي اللي كانت ناقصة وخلاتو يرسم ليك مبيان ديال 403 🛑
    if (!response.ok) {
      throw new Error(`Google Drive a refusé l'accès (Erreur ${response.status}). Vérifiez les permissions de l'API.`);
    }

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
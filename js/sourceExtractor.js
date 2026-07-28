// ============================================================
// sourceExtractor.js — Multi-source Data Ingestion (Complet & Final)
// ============================================================

/* global pdfjsLib, Tesseract */

const { Client, Functions } = window.Appwrite;

const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6a667fe600130a273954');

const functions = new Functions(client);

// الـ ID ديال الدالة اللي قاديتي فـ Appwrite
const EXTRACT_FUNCTION_ID = '6a69062e0007e544c697'; 

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

// --- Sites Web & YouTube (Appwrite Functions) ---
export async function extractWebsiteText(url) {
  try {
    const response = await functions.createExecution(
        EXTRACT_FUNCTION_ID, 
        JSON.stringify({ url: url })
    );

    const result = JSON.parse(response.responseBody);
    
    if (!result.success) {
        throw new Error(result.error || "Erreur inconnue dans le backend.");
    }

    if (result.text.length < 50) {
        throw new Error("Le texte extrait est trop court ou le site est protégé.");
    }

    return [{ pageNumber: 1, text: result.text }];
  } catch (error) {
    throw new Error(`Impossible de lire le lien: ${error.message}`);
  }
}

// --- Google Drive ---
export async function extractDriveText(docData, oauthToken) {
  if (docData.mimeType === "application/vnd.google-apps.document") {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${docData.id}/export?mimeType=text/plain`, {
      headers: { Authorization: `Bearer ${oauthToken}` }
    });
    
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
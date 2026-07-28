// ============================================================
// sourceExtractor.js — Modification pour utiliser Appwrite Functions
// ============================================================

// خصنا نجيبو Functions من Appwrite اللي ديجا مأنسطالي عندك فـ index.html
const { Client, Functions } = window.Appwrite;

const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6a667fe600130a273954'); // نفس الـ Project ID ديالك

const functions = new Functions(client);

// بدّل هاد الـ ID بالـ Function ID اللي عطاك Appwrite فاش كرييتيها
const EXTRACT_FUNCTION_ID = '6a69062e0007e544c697';

export async function extractWebsiteText(url) {
  try {
    // كنصيفطو الرابط للـ Backend ديالنا (Appwrite Function)
    const response = await functions.createExecution(
        EXTRACT_FUNCTION_ID, 
        JSON.stringify({ url: url })
    );

    // Appwrite كيرجع الجواب فـ responseBody
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
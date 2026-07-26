// ============================================================
// app.js — the only file that touches the DOM directly.
// It knows nothing about how extraction/graph-building, relation
// aggregation, source lookup, chat, export or resizing WORK
// internally — each of those lives in its own pure/network module
// with a clear input → output mold. This file only wires DOM
// events to those modules' functions and passes data through.
// ============================================================

import { runtimeAuth, RELATION_TYPES, RELATION_KEYS, DEFAULT_CONFIDENCE_THRESHOLD } from "./config.js";
import { extractPdfPages, wrapPastedText } from "./pdfReader.js";
import { execute as runPipeline } from "./pipeline.js";
import { render as renderGraph, updateThreshold } from "./graphRenderer.js";
import { getNodeRelations } from "./graphQueries.js";
import { computeLearningPath } from "./learningPath.js";
import { findSection, findSectionByQuote, highlightQuote } from "./sourceView.js";
import { askAboutConcept, askAboutDocument } from "./chatClient.js";
import { exportGraphToPdf, exportGraphToJson } from "./graphExporter.js";
import { initResizeHandle } from "./resizablePanels.js";
import { showToast, initThemeToggle } from "./ui.js";

// ============================================================
// Auth & Route Protection (Appwrite)
// ============================================================
// حيت حنا فـ module، Appwrite كنجبدوها من window
const { Client, Account, Databases, Teams, Permission, Role, ID } = window.Appwrite;const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6a667fe600130a273954');

const account = new Account(client);
const databases = new Databases(client);
const teams = new Teams(client);

const DATABASE_ID = '6a6682d6000846a6685e';
const COLLECTION_ID = 'kg-app'

let currentUser = null;
const urlParams = new URLSearchParams(window.location.search);
const graphId = urlParams.get('graphId');
// خاصنا واحد المتغير قابل للتحديث (ماشي const بحال graphId) حيت فاش
// كنولدو مبيان جديد (ماكانش graphId فالـ URL)، أول Sauvegarde تلقائية
// (juste après stage "extraction") هي لي غادي تعطينا $id ديال الوثيقة —
// من بعد كل سطوجات التالية (stage "graph"، rename...) خاصهم يحدثو
// نفس الوثيقة، ماشي يخلقو وحدة جديدة.
let currentDbId = graphId;
// ... الكود اللي الفوق


// هادو كيجيو من الإيميل ديال Appwrite
const teamIdParam = urlParams.get('teamId');
const membershipIdParam = urlParams.get('membershipId');
const userIdParam = urlParams.get('userId');
const secretParam = urlParams.get('secret');

account.get()
    .then(async (response) => {
        currentUser = response;
        document.body.style.display = 'block'; 
        document.getElementById('userNameDisplay').textContent = response.name || response.email || 'Utilisateur';

        // -------- كود قبول الدعوة --------
        if (teamIdParam && membershipIdParam && userIdParam && secretParam) {
            try {
                // قبول الدعوة 
                await teams.updateMembershipStatus(teamIdParam, membershipIdParam, userIdParam, secretParam);
                alert("Vous avez rejoint l'équipe de ce graphe avec succès !");
                
                // مسح ديك الروينة من الرابط باش يبقى نقي
                window.history.replaceState({}, document.title, window.location.pathname + "?graphId=" + graphId);
            } catch (err) {
                console.error("Erreur d'acceptation de l'invitation:", err);
                alert("L'invitation a expiré ou est invalide.");
            }
        }
        // ---------------------------------

        if (graphId) {
            await loadGraphFromDB(graphId);
        }
    })
    .catch((error) => {
        // إيلا كليكا على الرابط وهو مامكونيكطيش، نديوه لصفحة الدخول
        window.location.href = 'auth/login.html';
    });

// تأكد واش مكونيكطي واحتفظ باليوزر باش نربطو بيه المبيان
account.get()
    .then(async (response) => {
        currentUser = response;
        document.body.style.display = 'block';
        document.getElementById('userNameDisplay').textContent = response.name || response.email || 'Utilisateur';

        // إيلا كان graphId فـ URL، جبد ديك الداتا من Appwrite ورسمها نيشان
        if (graphId) {
            await loadGraphFromDB(graphId);
        }
    })
    .catch((error) => {
        window.location.href = 'auth/login.html';
    });

// دالة لجلب المبيان القديم ورسمه
async function loadGraphFromDB(id) {
    try {
        emptyState.style.display = "block";
        emptyState.textContent = "Récupération du graphe...";

        const doc = await databases.getDocument(DATABASE_ID, COLLECTION_ID, id);

        // Ownership check côté client — la vraie protection reste les
        // permissions Appwrite (collection/document level), mais ce
        // garde-fou évite qu'un $id deviné/partagé n'affiche un graphe
        // d'un autre compte dans CETTE session déjà authentifiée.
        if (doc.userId && doc.userId !== currentUser.$id) {
          showToast("Ce graphe ne t'appartient pas.", "error");
          window.location.href = "dashboard.html";
          return;
        }

        currentDbId = id;
        currentSourceCount = doc.sourceCount || 1;

        // تحويل النص المخزن إلى JSON Object ديال nodes و edges
        const parsedData = JSON.parse(doc.graphData);
        currentGraphData = parsedData;

        // كنجبدو التخزين ديال النص المصدر (sections ديال stage 1) إيلا كان محفوظ.
        // هادشي هو اللي كيخلي "aller à la source" و chat العام يخدمو حتى بعد
        // ما نسدو ونعاودو نحلو المبيان (قبل ماكانش كيتخزن غير nodes/edges).
        try {
          currentSections = doc.sections ? JSON.parse(doc.sections) : null;
        } catch {
          currentSections = null;
        }

        if (doc.title) graphTitleEl.textContent = doc.title;

        emptyState.style.display = "none";
        learningPathBtn.disabled = false;
        exportPdfBtn.disabled = false;
        exportJsonBtn.disabled = false;
        statsBtn.disabled = false;
        arrangeGraphBtn.disabled = false;

        drawGraph();
    } catch (err) {
        console.error("Erreur chargement graphe:", err);
        showToast("Impossible de charger ce graphe.", "error");
        emptyState.style.display = "block";
        emptyState.textContent = "Impossible de charger ce graphe.";
    }
}

// زر تسجيل الخروج (icône, même fonction qu'avant)
document.getElementById('logoutBtn').addEventListener('click', () => {
    account.deleteSession('current')
        .then(() => {
            window.location.href = 'auth/login.html';
        });
});

/* global pdfjsLib */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

// ---- DOM refs ----
const graphTitleEl = document.getElementById("graphTitle");
const apiKeyInput = document.getElementById("apiKey");
const dropzone = document.getElementById("dropzone");
const pdfInput = document.getElementById("pdfInput");
const pasteText = document.getElementById("pasteText");
const runBtn = document.getElementById("runBtn");
const graphContainer = document.getElementById("graphContainer");
const emptyState = document.getElementById("emptyState");
const legendEl = document.getElementById("legend");
const layoutEl = document.querySelector(".layout");

const learningPathBtn = document.getElementById("learningPathBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const statsBtn = document.getElementById("statsBtn");
const arrangeGraphBtn = document.getElementById("arrangeGraphBtn");

const confidenceSlider = document.getElementById("confidenceSlider");
const confidenceValue = document.getElementById("confidenceValue");

const mergeToggleWrap = document.getElementById("mergeToggleWrap");
const mergeToggleCheckbox = document.getElementById("mergeToggleCheckbox");

const jsonImportInput = document.getElementById("jsonImportInput");
const importJsonBtn = document.getElementById("importJsonBtn");

const rememberKeyCheckbox = document.getElementById("rememberKeyCheckbox");
const themeToggleBtn = document.getElementById("themeToggleBtn");

const statsModalBackdrop = document.getElementById("statsModalBackdrop");
const statsModalBody = document.getElementById("statsModalBody");
const statsModalClose = document.getElementById("statsModalClose");

const addRelationModalBackdrop = document.getElementById("addRelationModalBackdrop");
const addRelationModalClose = document.getElementById("addRelationModalClose");
const addRelationForm = document.getElementById("addRelationForm");
const relationFromSelect = document.getElementById("relationFromSelect");
const relationTypeSelect = document.getElementById("relationTypeSelect");
const relationToSelect = document.getElementById("relationToSelect");

const sourceResult = document.getElementById("sourceResult");
const sourceResultBlock = document.getElementById("sourceResultBlock");

const nodePopupBackdrop = document.getElementById("nodePopupBackdrop");
const nodePopupBody = document.getElementById("nodePopupBody");
const nodePopupClose = document.getElementById("nodePopupClose");

const chatContextTitle = document.getElementById("chatContextTitle");
const chatContextHint = document.getElementById("chatContextHint");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");

const pathModalBackdrop = document.getElementById("pathModalBackdrop");
const pathList = document.getElementById("pathList");
const pathCycleNote = document.getElementById("pathCycleNote");
const pathModalClose = document.getElementById("pathModalClose");

// ---- app state ----
let selectedFile = null;
let currentGraphData = null;  // {nodes, edges} — stage 2 output, kept for export/chat/path
let currentSections = null;   // stage 1 output — kept for "aller à la source" + chat context
let currentCy = null;         // live Cytoscape instance — kept for export + programmatic selection
let activeChatNode = null;    // which node the inline chat is currently about
let currentConfidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD; // pilotée par le slider
let currentSourceCount = 1;   // nombre de sources fusionnées dans ce graphe (mode "ajouter une source")

initThemeToggle(themeToggleBtn);

// ============================================================
// Clé API Mistral — mémoire par défaut (jamais persistée), avec un
// opt-in explicite "se souvenir" qui la garde en sessionStorage
// (effacée à la fermeture de l'onglet, jamais localStorage/disque).
// ============================================================
const SESSION_KEY_STORAGE = "constella-mistral-key";

const savedSessionKey = sessionStorage.getItem(SESSION_KEY_STORAGE);
if (savedSessionKey) {
  apiKeyInput.value = savedSessionKey;
  runtimeAuth.apiKey = savedSessionKey;
  rememberKeyCheckbox.checked = true;
}

rememberKeyCheckbox.addEventListener("change", () => {
  if (rememberKeyCheckbox.checked) {
    sessionStorage.setItem(SESSION_KEY_STORAGE, apiKeyInput.value.trim());
  } else {
    sessionStorage.removeItem(SESSION_KEY_STORAGE);
  }
});

// ============================================================
// Titre du graphe — clic pour renommer (contenteditable)
// ============================================================
graphTitleEl.addEventListener("click", () => {
  if (graphTitleEl.isContentEditable) return;
  graphTitleEl.contentEditable = "true";
  graphTitleEl.classList.add("editing");
  graphTitleEl.focus();
  document.execCommand("selectAll", false, null);
});

async function commitGraphTitle() {
  graphTitleEl.contentEditable = "false";
  graphTitleEl.classList.remove("editing");
  const newTitle = graphTitleEl.textContent.trim() || "Nouveau graphe";
  graphTitleEl.textContent = newTitle;

  // إيلا كان المبيان محفوظ ديجا (عندو ID فالـ DB)، صيفط التسمية الجديدة لـ Appwrite
  if (currentDbId) {
    try {
      await databases.updateDocument(DATABASE_ID, COLLECTION_ID, currentDbId, { title: newTitle });
    } catch (err) {
      console.error("Erreur renommage:", err);
      showToast("Impossible d'enregistrer le nouveau titre.", "error");
    }
  }
}

graphTitleEl.addEventListener("blur", commitGraphTitle);
graphTitleEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    graphTitleEl.blur();
  }
});

// ============================================================
// Organiser le graphe (vue parcours)
// ============================================================
arrangeGraphBtn.addEventListener("click", () => {
  if (!currentCy) return;
  currentCy.layout({
    name: "breadthfirst",
    directed: true,
    spacingFactor: 1.2,
    padding: 30,
    animate: true,
    animationDuration: 600
  }).run();
});

// ============================================================
// API key — memory only par défaut, jamais persisté sur disque (voir
// README) ; sessionStorage seulement si "se souvenir" est coché.
// ============================================================
apiKeyInput.addEventListener("input", () => {
  runtimeAuth.apiKey = apiKeyInput.value.trim();
  if (rememberKeyCheckbox.checked) {
    sessionStorage.setItem(SESSION_KEY_STORAGE, runtimeAuth.apiKey);
  }
});

// ============================================================
// File selection
// ============================================================
dropzone.addEventListener("click", () => pdfInput.click());
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  if (e.dataTransfer.files[0]) setSelectedFile(e.dataTransfer.files[0]);
});
pdfInput.addEventListener("change", () => {
  if (pdfInput.files[0]) setSelectedFile(pdfInput.files[0]);
});

function setSelectedFile(file) {
  selectedFile = file;
  dropzone.querySelector("p strong").textContent = file.name;
  pasteText.value = "";
}

// ============================================================
// Legend
// ============================================================
legendEl.innerHTML = RELATION_TYPES.map(
  (r) => `
  <li data-type="${r.key}">
    <span class="swatch" style="background:${r.color};
      border-bottom:${r.lineStyle === "dashed" ? "2px dashed" + r.color : ""}"></span>
    ${r.label}
  </li>`
).join("");

let activeLegendType = null;

legendEl.querySelectorAll("li").forEach((li) => {
  li.addEventListener("click", () => {
    const type = li.dataset.type;
    activeLegendType = activeLegendType === type ? null : type;
    legendEl.querySelectorAll("li").forEach((el) => el.classList.toggle("active", el.dataset.type === activeLegendType));
    applyLegendFilter(activeLegendType);
  });
});

/** Highlights nodes/edges touched by `type`'s relation and dims the rest; null clears it. */
function applyLegendFilter(type) {
  if (!currentCy) return;
  currentCy.elements().removeClass("legend-dim legend-highlight");
  if (!type) return;

  const matchingEdges = currentCy.edges(`[type = "${type}"]`);
  const touchedNodeIds = new Set();
  matchingEdges.forEach((e) => {
    touchedNodeIds.add(e.data("source"));
    touchedNodeIds.add(e.data("target"));
  });

  currentCy.edges().difference(matchingEdges).addClass("legend-dim");
  currentCy.nodes().forEach((n) => {
    n.addClass(touchedNodeIds.has(n.id()) ? "legend-highlight" : "legend-dim");
  });
  matchingEdges.addClass("legend-highlight");
}

// ============================================================
// Confidence threshold slider — filtre visuel des relations, sans
// re-générer le graphe ni re-appeler Mistral (juste un re-render
// Cytoscape avec un seuil différent, cf. graphRenderer.updateThreshold).
// ============================================================
confidenceSlider.addEventListener("input", () => {
  currentConfidenceThreshold = Number(confidenceSlider.value) / 100;
  confidenceValue.textContent = `${confidenceSlider.value}%`;

  if (!currentGraphData) return;

  const cy = updateThreshold(currentGraphData, currentConfidenceThreshold, graphContainer, {
    onNodeClick: showNodeDetail,
    onEdgeClick: showEdgeDetail,
  });
  if (cy) {
    currentCy = cy;
    currentCy.on("tap", (evt) => {
      if (evt.target === currentCy) closeNodePopup();
    });
  }
});

// ============================================================
// Progress feedback — plus de bloc "Pipeline" séparé, on affiche
// juste les étapes dans emptyState (déjà visible pendant le run).
// ============================================================
function setStage(message, status) {
  emptyState.style.display = "block";
  emptyState.textContent = message;
  emptyState.classList.toggle("error", status === "error");
}

// ============================================================
// Run pipeline
// ============================================================
runBtn.addEventListener("click", async () => {
  if (!runtimeAuth.apiKey) {
    alert("Colle ta clé API Mistral en haut à droite d'abord.");
    return;
  }
  if (!selectedFile && !pasteText.value.trim()) {
    alert("Dépose un PDF ou colle du texte d'abord.");
    return;
  }

  // Mode "ajouter une source" : seulement possible/pertinent s'il y a déjà
  // un graphe. Capturé AVANT que le pipeline ne commence à écrire dans
  // currentGraphData/currentSections.
  const mergeMode = mergeToggleCheckbox.checked && !!currentGraphData?.nodes?.length;
  const previousSections = currentSections;
  const previousGraphData = currentGraphData;

  runBtn.disabled = true;
  learningPathBtn.disabled = true;
  exportPdfBtn.disabled = true;
  exportJsonBtn.disabled = true;
  statsBtn.disabled = true;
  arrangeGraphBtn.disabled = true;
  closeNodePopup();
  setStage(mergeMode ? "Extraction de la nouvelle source..." : "Extraction en cours...", "active");

  try {
    const pages = selectedFile
      ? await extractPdfPages(selectedFile)
      : wrapPastedText(pasteText.value);

    // Préfixe unique pour cette exécution — sert à éviter toute collision
    // d'id (sections/nodes/edges) quand on fusionne dans un graphe existant.
    const runToken = Date.now().toString(36);

    const context = {
      apiKey: runtimeAuth.apiKey,
      onProgress: (msg) => setStage(msg, "active"),
      // كنحفظو تلقائيًا فـ Appwrite بمجرد ماكل مرحلة كتنتج نتيجتها —
      // ماشي كنتسناو نهاية الـ pipeline كاملة. هكاك، إيلا الموديل نتج
      // sections (stage "extraction") ومن بعد وقع خطأ فـ stage "graph"،
      // السورس يبقى محفوظ فالـ DB ومايضيعش.
      onStageComplete: async (stageName, output) => {
        if (stageName === "extraction") {
          if (mergeMode && previousSections) {
            // نرينوميرو sections الجداد باش مايتقاطعوش مع ids الكاينين
            // ديجا (s1, s2...) — كنبدلو ids ديال "output" IN PLACE، هكاك
            // stage "graph" اللي غادي تجي من بعد فـ pipeline.js غادي تشوف
            // نفس ids الجداد (pipeline.js كيصيفط نفس الـ reference).
            const baseIndex = previousSections.length;
            output.forEach((s, i) => { s.id = `${runToken}_s${baseIndex + i + 1}`; });
            currentSections = [...previousSections, ...output];
          } else {
            currentSections = output;
          }
        } else if (stageName === "graph") {
          if (mergeMode && previousGraphData) {
            currentGraphData = mergeGraphData(previousGraphData, output, runToken);
          } else {
            currentGraphData = output;
          }
        }
        try {
          setStage(
            stageName === "extraction"
              ? "Sauvegarde du texte source..."
              : "Sauvegarde du graphe...",
            "active"
          );
          await persistGraphToDatabase();
        } catch (saveError) {
          // خطأ ف Sauvegarde ماخصوش يوقف الـ pipeline (الموديل مزال خدام) —
          // كنسجلوه فـ console + toast غير مزعج (non-bloquant).
          console.error(`Erreur de sauvegarde automatique (${stageName}):`, saveError);
          showToast("Échec de la sauvegarde automatique — le texte/graphe reste affiché, réessaie plus tard.", "error");
        }
      },
    };

    if (mergeMode) currentSourceCount += 1;

    // pipeline.execute() renvoie la sortie de CHAQUE étape, indexée par
    // nom — on a besoin des sections de l'étape "extraction" plus tard
    // pour "aller à la source" et le chat, en plus du graphe final.
    // (currentSections / currentGraphData sont déjà à jour ici grâce à
    // onStageComplete, mais on les réaffecte pour rester explicite — pas
    // utile en mode merge, où onStageComplete a déjà fait la fusion.)
    const results = await runPipeline(pages, context);
    if (!mergeMode) {
      currentSections = results.extraction;
      currentGraphData = results.graph;
    }

    learningPathBtn.disabled = false;
    exportPdfBtn.disabled = false;
    exportJsonBtn.disabled = false;
    statsBtn.disabled = false;
    arrangeGraphBtn.disabled = false;

    // نمسحو الفورم باش المستخدم مايعاودش يبعث نفس السورس بالغلط
    selectedFile = null;
    pasteText.value = "";
    dropzone.querySelector("p strong").textContent = "Dépose un PDF";
    mergeToggleCheckbox.checked = false;

    emptyState.style.display = "none";
    drawGraph();
    showToast(mergeMode ? "Source ajoutée au graphe." : "Graphe généré.", "success");
  } catch (err) {
    setStage(err.message, "error");
    showToast(err.message, "error");
  } finally {
    runBtn.disabled = false;
  }
});

/**
 * Fusionne le graphe fraîchement extrait (`fresh`, sortie de stage "graph"
 * sur la NOUVELLE source uniquement) dans le graphe existant (`existing`).
 * Dédoublonne les nœuds par label (insensible à la casse/espaces) — si
 * "Débit" existe déjà, le nouveau nœud "débit" est fusionné dedans plutôt
 * que dupliqué, et toute relation qui le référence est remappée vers le
 * nœud existant. Limite connue : dédoublonnage par égalité de libellé
 * uniquement (pas de correspondance sémantique/fuzzy).
 */
function mergeGraphData(existing, fresh, runToken) {
  const idMap = new Map(); // id (dans `fresh`) -> id final (existant réutilisé, ou nouveau préfixé)
  const mergedNodes = [...existing.nodes];

  fresh.nodes.forEach((n) => {
    const match = existing.nodes.find(
      (en) => en.label.trim().toLowerCase() === n.label.trim().toLowerCase()
    );
    if (match) {
      idMap.set(n.id, match.id);
    } else {
      const newId = `${runToken}_${n.id}`;
      idMap.set(n.id, newId);
      mergedNodes.push({ ...n, id: newId });
    }
  });

  const mergedEdges = [...existing.edges];
  const existingEdgeKeys = new Set(existing.edges.map((e) => `${e.source}|${e.target}|${e.type}`));

  fresh.edges.forEach((e) => {
    const source = idMap.get(e.source) ?? e.source;
    const target = idMap.get(e.target) ?? e.target;
    const key = `${source}|${target}|${e.type}`;
    if (existingEdgeKeys.has(key)) return; // déjà présente (probablement entre 2 nœuds dédupliqués)
    existingEdgeKeys.add(key);
    mergedEdges.push({ ...e, id: `${runToken}_${e.id}`, source, target });
  });

  return { nodes: mergedNodes, edges: mergedEdges };
}

/**
 * Crée OU met à jour (selon `currentDbId`) le document Appwrite du
 * graphe courant, avec ce qu'on a sous la main pour l'instant (sections
 * et/ou graphData — l'un des deux peut encore être vide juste après
 * stage "extraction"). Toujours appelée automatiquement, jamais un
 * bouton "sauvegarder" séparé.
 */
async function persistGraphToDatabase() {
  const graphTitle = graphTitleEl.textContent.trim() ||
    (selectedFile ? selectedFile.name.replace(/\.pdf$/i, "") : "Texte collé");
  graphTitleEl.textContent = graphTitle;

  // نصيفطو ديما JSON string صحيحة (ماشي null/undefined) حيت Appwrite
  // كيتسنى string فهاد attributes — واخا currentGraphData مازال ماوصلش.
  const payload = {
    userId: currentUser.$id,
    title: graphTitle,
    icon: '📄',
    sourceCount: currentSourceCount,
    graphData: JSON.stringify(currentGraphData ?? {}),
    sections: JSON.stringify(currentSections ?? null),
  };

  if (!currentDbId) {
    const doc = await databases.createDocument(DATABASE_ID, COLLECTION_ID, ID.unique(), payload);
    currentDbId = doc.$id;
    // نحدثو الـ URL بلا reload، باش أي update لاحقة (rename، stage "graph"،
    // ريفريش ديال الصفحة...) تلقى نفس الوثيقة بدل ما تخلق وحدة جديدة.
    const url = new URL(window.location.href);
    url.searchParams.set('graphId', currentDbId);
    window.history.replaceState({}, '', url);
  } else {
    await databases.updateDocument(DATABASE_ID, COLLECTION_ID, currentDbId, payload);
  }
}

// ============================================================
// Graph rendering
// ============================================================
function drawGraph() {
  activeLegendType = null;
  legendEl.querySelectorAll("li").forEach((el) => el.classList.remove("active"));

  // إيلا ماكنا فـ mode "concept" (activeChatNode)، حدث الـ hint ديال الشات
  // باش يبين للمستخدم واش يقدر يسول سؤال عام (خاصو currentSections).
  if (!activeChatNode) {
    chatContextHint.textContent = currentSections
      ? "Pose une question sur le document entier, ou clique sur un concept dans le graphe pour une question ciblée."
      : "Clique sur un concept dans le graphe, puis « Demander à l'IA ».";
  }

  // خيار "ajouter une source" ما كيبانش غير إيلا كاين ديجا غراف نقدرو
  // نزيدو عليه (ماشي أول extraction).
  mergeToggleWrap.style.display = currentGraphData?.nodes?.length ? "flex" : "none";

  currentCy = renderGraph(currentGraphData, graphContainer, {
    confidenceThreshold: currentConfidenceThreshold,
    onNodeClick: showNodeDetail,
    onEdgeClick: showEdgeDetail,
  });

  // كليك فراغ المبيان (ماشي على node/edge) كيسد الـ popup
  currentCy.on("tap", (evt) => {
    if (evt.target === currentCy) closeNodePopup();
  });
}

// ============================================================
// Detail popup — node (definition + aggregated relations)
// ============================================================
function showNodeDetail(node) {
  const relations = getNodeRelations(node.id, currentGraphData);

  nodePopupBody.innerHTML = `
    <div class="detail-card">
      <h3>${escapeHtml(node.label)}</h3>
      <p>${escapeHtml(node.definition)}</p>
      <p class="field-label">Source (section ${escapeHtml(node.sourceSectionId)})</p>
      <p class="quote">"${escapeHtml(node.sourceQuote)}"</p>

      ${renderRelationsBlock("Ce que ce concept implique / produit", relations.outgoing)}
      ${renderRelationsBlock("Ce qui mène à ce concept", relations.incoming)}

      <div id="nodeEditZone"></div>

      <div class="detail-actions">
        <button data-role="ask-ai"><i class="fa-solid fa-robot"></i> Demander à l'IA</button>
        <button data-role="go-to-source"><i class="fa-solid fa-quote-right"></i> Voir dans le texte source</button>
        <button data-role="edit-node"><i class="fa-solid fa-pen"></i> Modifier</button>
        <button data-role="add-relation"><i class="fa-solid fa-link"></i> Ajouter une relation</button>
      </div>
    </div>`;

  nodePopupBody.querySelector('[data-role="ask-ai"]')
    ?.addEventListener("click", () => openInlineChat(node));

  nodePopupBody.querySelector('[data-role="go-to-source"]')
    ?.addEventListener("click", () => showSourceInLeftPanel({ sectionId: node.sourceSectionId, quote: node.sourceQuote }));

  nodePopupBody.querySelector('[data-role="edit-node"]')
    ?.addEventListener("click", () => showNodeEditForm(node));

  nodePopupBody.querySelector('[data-role="add-relation"]')
    ?.addEventListener("click", () => openAddRelationModal(node.id));

  nodePopupBody.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const relatedNode = currentGraphData.nodes.find((n) => n.id === chip.dataset.nodeId);
      if (!relatedNode) return;
      selectNodeInGraph(relatedNode.id);
      showNodeDetail(relatedNode);
    });
  });

  openNodePopup();
}

/**
 * Formulaire d'édition inline (label + définition) — corrige une erreur
 * du modèle sans avoir à relancer toute l'extraction. Met à jour
 * currentGraphData ET l'élément Cytoscape déjà rendu (pas de redraw
 * complet, donc zoom/position du graphe ne bougent pas), puis sauvegarde.
 */
function showNodeEditForm(node) {
  const zone = nodePopupBody.querySelector("#nodeEditZone");
  if (!zone) return;

  zone.innerHTML = `
    <p class="field-label">Modifier le concept</p>
    <input type="text" class="edit-field" id="editNodeLabel" value="${escapeHtml(node.label)}" />
    <textarea class="edit-field" id="editNodeDefinition" rows="3">${escapeHtml(node.definition)}</textarea>
    <div class="edit-actions-row">
      <button type="button" class="primary" id="saveNodeEditBtn">Enregistrer</button>
      <button type="button" id="cancelNodeEditBtn">Annuler</button>
    </div>
  `;

  zone.querySelector("#cancelNodeEditBtn").addEventListener("click", () => showNodeDetail(node));

  zone.querySelector("#saveNodeEditBtn").addEventListener("click", async () => {
    const newLabel = zone.querySelector("#editNodeLabel").value.trim();
    const newDefinition = zone.querySelector("#editNodeDefinition").value.trim();
    if (!newLabel) return;

    node.label = newLabel;
    node.definition = newDefinition;

    // Cytoscape : on met juste à jour les data du nœud existant, pas
    // besoin de tout redessiner (préserve le layout/zoom en cours).
    currentCy?.$id(node.id).data({ label: newLabel, definition: newDefinition });

    showNodeDetail(node);

    try {
      await persistGraphToDatabase();
      showToast("Concept mis à jour.", "success");
    } catch (err) {
      console.error("Erreur édition nœud:", err);
      showToast("Modifié localement, mais la sauvegarde a échoué.", "error");
    }
  });
}

/** Renders one grouped-relations section, or nothing if the node has none in that direction. */
function renderRelationsBlock(title, groups) {
  if (!groups.length) return "";
  return `
    <div class="relations-block">
      <h4>${escapeHtml(title)}</h4>
      ${groups
        .map(
          (g) => `
        <div class="relation-group">
          <div class="relation-type-label" style="color:${g.color}">${escapeHtml(g.label)}</div>
          <div class="chip-list">
            ${g.items
              .map((item) => `<span class="chip" data-node-id="${item.node.id}">${escapeHtml(item.node.label)}</span>`)
              .join("")}
          </div>
        </div>`
        )
        .join("")}
    </div>`;
}

// ============================================================
// Detail popup — edge
// ============================================================
function showEdgeDetail(edge) {
  const relType = RELATION_TYPES.find((r) => r.key === edge.type);

  nodePopupBody.innerHTML = `
    <div class="detail-card">
      <h3>${relType?.label ?? edge.type}</h3>
      <p class="field-label">Relation</p>
      <p>${escapeHtml(edge.source)} → ${escapeHtml(edge.target)}</p>
      <p class="field-label">Confiance</p>
      <div class="confidence-bar"><div class="confidence-fill" style="width:${edge.confidence * 100}%"></div></div>
      <p class="field-label">Source</p>
      <p class="quote">"${escapeHtml(edge.sourceQuote)}"</p>

      <div id="edgeEditZone">
        <p class="field-label">Modifier le type</p>
        <select class="edit-field" id="editEdgeType">
          ${RELATION_TYPES.map((r) => `<option value="${r.key}" ${r.key === edge.type ? "selected" : ""}>${escapeHtml(r.label)}</option>`).join("")}
        </select>
      </div>

      <div class="detail-actions">
        <button data-role="go-to-source"><i class="fa-solid fa-quote-right"></i> Voir dans le texte source</button>
        <button data-role="save-edge-type"><i class="fa-solid fa-check"></i> Enregistrer le type</button>
        <button data-role="delete-edge" class="danger-action"><i class="fa-solid fa-trash"></i> Supprimer la relation</button>
      </div>
    </div>`;

  // Les edges n'ont pas de sourceSectionId dans le schéma actuel du graphe
  // (seuls les nodes en ont) — showSourceInLeftPanel cherche dans toutes
  // les sections par citation quand sectionId est absent.
  nodePopupBody.querySelector('[data-role="go-to-source"]')
    ?.addEventListener("click", () => showSourceInLeftPanel({ quote: edge.sourceQuote }));

  nodePopupBody.querySelector('[data-role="save-edge-type"]')?.addEventListener("click", async () => {
    const newType = nodePopupBody.querySelector("#editEdgeType").value;
    if (!RELATION_KEYS.includes(newType) || newType === edge.type) return;
    edge.type = newType;
    drawGraph(); // le style (couleur/forme de flèche) dépend du type -> redraw complet nécessaire
    try {
      await persistGraphToDatabase();
      showToast("Type de relation mis à jour.", "success");
    } catch (err) {
      console.error("Erreur édition relation:", err);
      showToast("Modifié localement, mais la sauvegarde a échoué.", "error");
    }
  });

  nodePopupBody.querySelector('[data-role="delete-edge"]')?.addEventListener("click", async () => {
    if (!confirm("Supprimer cette relation ?")) return;
    currentGraphData.edges = currentGraphData.edges.filter((e) => e.id !== edge.id);
    closeNodePopup();
    drawGraph();
    try {
      await persistGraphToDatabase();
      showToast("Relation supprimée.", "success");
    } catch (err) {
      console.error("Erreur suppression relation:", err);
      showToast("Supprimé localement, mais la sauvegarde a échoué.", "error");
    }
  });

  openNodePopup();
}

function openNodePopup() {
  nodePopupBackdrop.classList.add("open");
}
function closeNodePopup() {
  nodePopupBackdrop.classList.remove("open");
}
nodePopupClose.addEventListener("click", closeNodePopup);
nodePopupBackdrop.addEventListener("click", (e) => {
  if (e.target === nodePopupBackdrop) closeNodePopup();
});

function selectNodeInGraph(nodeId) {
  if (!currentCy) return;
  currentCy.elements().unselect();
  const ele = currentCy.$id(nodeId);
  if (ele.length) {
    ele.select();
    currentCy.animate({ center: { eles: ele } }, { duration: 300 });
  }
}

// ============================================================
// "Aller à la source" — affiché dans le panel gauche (jamais en
// popup ni en span : le résultat vit dans panel-left, surligné).
// ============================================================
function showSourceInLeftPanel({ sectionId, quote }) {
  if (!currentSections) {
    sourceResult.innerHTML = `<p class="empty-hint">Le texte source n'est pas disponible pour ce graphe (chargé depuis un ancien enregistrement).</p>`;
  } else {
    const section = sectionId
      ? findSection(currentSections, sectionId)
      : findSectionByQuote(currentSections, quote);

    if (!section) {
      sourceResult.innerHTML = `<p class="empty-hint">Impossible de retrouver ce passage dans le texte source.</p>`;
    } else {
      const { chunks } = highlightQuote(section.text, quote);
      const body = chunks
        .map((c) => (c.highlight ? `<mark>${escapeHtml(c.text)}</mark>` : escapeHtml(c.text)))
        .join("");
      sourceResult.innerHTML = `
        <p class="source-heading">${escapeHtml(section.id)} — ${escapeHtml(section.heading)}</p>
        ${body}`;
    }
  }

  sourceResultBlock.scrollIntoView({ block: "start", behavior: "smooth" });
  sourceResult.querySelector("mark")?.scrollIntoView({ block: "center", behavior: "smooth" });
}

// ============================================================
// Inline chat (panel droit) — "Demander à l'IA"
//
// Deux modes :
//  - mode "concept" (activeChatNode défini) : question ciblée sur UN
//    nœud précis, via askAboutConcept — comportement inchangé.
//  - mode "général" (activeChatNode = null) : aucun concept choisi,
//    la question porte sur le document entier. On envoie TOUTES les
//    sections à askAboutDocument, qui répond STRICTEMENT à partir de
//    ce texte (jamais "de sa tête") et renvoie la réponse découpée en
//    segments, chacun optionnellement relié à une citation exacte du
//    texte source. Chaque segment sourcé s'affiche comme un passage
//    cliquable : un clic ouvre le passage correspondant, surligné,
//    dans le panel gauche ("aller à la source").
// ============================================================
function openInlineChat(node) {
  activeChatNode = node;
  chatContextTitle.innerHTML = `À propos de : ${escapeHtml(node.label)} <button type="button" class="chat-mode-reset" id="chatModeReset" title="Revenir aux questions générales">✕ mode général</button>`;
  document.getElementById("chatModeReset")?.addEventListener("click", resetChatToGeneralMode);
  chatContextHint.style.display = "none";
  chatMessages.innerHTML = "";
  chatInput.focus();
  closeNodePopup();
}

function resetChatToGeneralMode() {
  activeChatNode = null;
  chatContextTitle.textContent = "Assistant IA";
  chatContextHint.style.display = "block";
  chatContextHint.textContent = currentSections
    ? "Pose une question sur le document entier, ou clique sur un concept dans le graphe pour une question ciblée."
    : "Clique sur un concept dans le graphe, puis « Demander à l'IA ».";
  chatInput.focus();
}

async function handleChat() {
  const question = chatInput.value.trim();
  if (!question) return;

  if (!runtimeAuth.apiKey) {
    alert("Colle ta clé API Mistral en haut à droite d'abord.");
    return;
  }

  const useConceptMode = !!activeChatNode;
  if (!useConceptMode && !currentSections) {
    alert("Lance d'abord une extraction (ou clique sur un concept dans le graphe) avant de poser une question.");
    return;
  }

  appendMessage("user", question);
  chatInput.value = "";
  chatSendBtn.disabled = true;

  const pendingEl = appendMessage("assistant pending", "Réflexion en cours...");

  try {
    if (useConceptMode) {
      const section = currentSections ? findSection(currentSections, activeChatNode.sourceSectionId) : null;
      const answer = await askAboutConcept({
        apiKey: runtimeAuth.apiKey,
        node: activeChatNode,
        sectionText: section?.text,
        question,
      });
      pendingEl.remove();
      appendMessage("assistant", answer);
    } else {
      const segments = await askAboutDocument({
        apiKey: runtimeAuth.apiKey,
        sections: currentSections,
        question,
      });
      pendingEl.remove();
      appendSegmentedMessage("assistant", segments);
    }
  } catch (err) {
    pendingEl.remove();
    appendMessage("assistant error", `Erreur : ${err.message}`);
  } finally {
    chatSendBtn.disabled = false;
  }
}

function appendMessage(cssClass, text) {
  const el = document.createElement("div");
  el.className = `chat-msg ${cssClass}`;
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

/**
 * Rend une réponse "mode général" segment par segment : chaque segment
 * sourcé (sourceQuote + sectionId) devient un <span> cliquable qui ouvre
 * le passage correspondant, surligné, dans le panel gauche.
 */
function appendSegmentedMessage(cssClass, segments) {
  const el = document.createElement("div");
  el.className = `chat-msg ${cssClass}`;

  segments.forEach((seg, i) => {
    const hasCitation = !!(seg.sourceQuote && seg.sectionId);
    const span = document.createElement("span");
    span.textContent = seg.text;

    if (hasCitation) {
      span.className = "cite-mark";
      span.title = "Cliquer pour voir le passage source";
      span.setAttribute("role", "button");
      span.tabIndex = 0;
      const openSource = () => showSourceInLeftPanel({ sectionId: seg.sectionId, quote: seg.sourceQuote });
      span.addEventListener("click", openSource);
      span.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openSource();
        }
      });
    }

    el.appendChild(span);
    if (i < segments.length - 1) el.appendChild(document.createTextNode(" "));
  });

  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

chatSendBtn.addEventListener("click", handleChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleChat();
});

// ============================================================
// Learning path modal
// ============================================================
learningPathBtn.addEventListener("click", () => {
  if (!currentGraphData) return;
  const { order, cycles } = computeLearningPath(currentGraphData);

  pathList.innerHTML = order
    .map((node) => `<li data-node-id="${node.id}">${escapeHtml(node.label)}</li>`)
    .join("");

  pathList.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => {
      const node = currentGraphData.nodes.find((n) => n.id === li.dataset.nodeId);
      if (!node) return;
      closePathModal();
      selectNodeInGraph(node.id);
      showNodeDetail(node);
    });
  });

  if (cycles.length) {
    pathCycleNote.style.display = "block";
    pathCycleNote.textContent =
      `⚠ ${cycles[0].length} concept(s) forment un cycle de prérequis et ne peuvent pas être ordonnés ` +
      `strictement — ils sont listés en fin de liste.`;
  } else {
    pathCycleNote.style.display = "none";
  }

  pathModalBackdrop.classList.add("open");
});

function closePathModal() {
  pathModalBackdrop.classList.remove("open");
}
pathModalClose.addEventListener("click", closePathModal);
pathModalBackdrop.addEventListener("click", (e) => {
  if (e.target === pathModalBackdrop) closePathModal();
});

// ============================================================
// Export PDF
// ============================================================
exportPdfBtn.addEventListener("click", async () => {
  if (!currentCy || !currentGraphData) return;
  exportPdfBtn.disabled = true;
  try {
    await exportGraphToPdf(currentCy, currentGraphData, { title: graphTitleEl.textContent.trim() || "Graphe de concepts" });
    showToast("PDF exporté.", "success");
  } catch (err) {
    showToast(`Échec de l'export PDF : ${err.message}`, "error");
  } finally {
    exportPdfBtn.disabled = false;
  }
});

// ============================================================
// Export JSON (données brutes — nodes/edges)
// ============================================================
exportJsonBtn.addEventListener("click", () => {
  if (!currentGraphData) return;
  try {
    exportGraphToJson(currentGraphData, { title: graphTitleEl.textContent.trim() || "graphe" });
  } catch (err) {
    showToast(`Échec de l'export JSON : ${err.message}`, "error");
  }
});

// ============================================================
// Import JSON — démarre un NOUVEAU graphe à partir d'un export
// précédent (nodes/edges). Le texte source (sections) n'est pas
// inclus dans cet export, donc "aller à la source" ne sera pas
// disponible pour un graphe importé — comportement déjà géré par
// showSourceInLeftPanel quand currentSections est null.
// ============================================================
importJsonBtn.addEventListener("click", () => jsonImportInput.click());

jsonImportInput.addEventListener("change", async () => {
  const file = jsonImportInput.files[0];
  jsonImportInput.value = ""; // permet de réimporter le même fichier deux fois de suite
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed?.nodes) || !Array.isArray(parsed?.edges)) {
      throw new Error("Le fichier ne contient pas un graphe valide (attendu : { nodes: [...], edges: [...] }).");
    }

    currentGraphData = { nodes: parsed.nodes, edges: parsed.edges };
    currentSections = null; // pas de texte source dans un JSON importé
    currentDbId = null;     // on démarre un NOUVEAU document en base
    currentSourceCount = 1;
    activeChatNode = null;

    graphTitleEl.textContent = file.name.replace(/\.json$/i, "") || "Graphe importé";

    learningPathBtn.disabled = false;
    exportPdfBtn.disabled = false;
    exportJsonBtn.disabled = false;
    statsBtn.disabled = false;
    arrangeGraphBtn.disabled = false;

    emptyState.style.display = "none";
    drawGraph();

    try {
      await persistGraphToDatabase();
    } catch (saveError) {
      console.error("Erreur sauvegarde import:", saveError);
      showToast("Graphe importé, mais la sauvegarde a échoué — réessaie de le renommer pour forcer une sauvegarde.", "error");
    }

    showToast("Graphe importé.", "success");
  } catch (err) {
    showToast(`Échec de l'import : ${err.message}`, "error");
  }
});

// ============================================================
// Statistiques du graphe
// ============================================================
statsBtn.addEventListener("click", () => {
  if (!currentGraphData) return;

  const { nodes, edges } = currentGraphData;
  const avgConfidence = edges.length
    ? edges.reduce((sum, e) => sum + (e.confidence ?? 0), 0) / edges.length
    : 0;

  const breakdown = RELATION_TYPES.map((r) => ({
    ...r,
    count: edges.filter((e) => e.type === r.key).length,
  })).filter((r) => r.count > 0);

  statsModalBody.innerHTML = `
    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-value">${nodes.length}</div>
        <div class="stat-label">Concepts</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${edges.length}</div>
        <div class="stat-label">Relations</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${Math.round(avgConfidence * 100)}%</div>
        <div class="stat-label">Confiance moyenne</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${currentSourceCount}</div>
        <div class="stat-label">Source(s)</div>
      </div>
    </div>
    ${breakdown
      .map(
        (r) => `
      <div class="stats-breakdown-row">
        <span style="color:${r.color}">${escapeHtml(r.label)}</span>
        <span>${r.count}</span>
      </div>`
      )
      .join("")}
  `;

  statsModalBackdrop.classList.add("open");
});
statsModalClose.addEventListener("click", () => statsModalBackdrop.classList.remove("open"));
statsModalBackdrop.addEventListener("click", (e) => {
  if (e.target === statsModalBackdrop) statsModalBackdrop.classList.remove("open");
});

// ============================================================
// Ajouter une relation manuelle (corrige un lien manqué par le
// modèle). Confiance fixée à 1, pas de citation source (ajout humain).
// ============================================================
function openAddRelationModal(fromNodeId) {
  if (!currentGraphData?.nodes?.length) return;

  const optionsHtml = currentGraphData.nodes
    .map((n) => `<option value="${n.id}">${escapeHtml(n.label)}</option>`)
    .join("");
  relationFromSelect.innerHTML = optionsHtml;
  relationToSelect.innerHTML = optionsHtml;
  relationTypeSelect.innerHTML = RELATION_TYPES.map((r) => `<option value="${r.key}">${escapeHtml(r.label)}</option>`).join("");

  if (fromNodeId) relationFromSelect.value = fromNodeId;

  closeNodePopup();
  addRelationModalBackdrop.classList.add("open");
}

addRelationForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const source = relationFromSelect.value;
  const target = relationToSelect.value;
  const type = relationTypeSelect.value;

  if (source === target) {
    showToast("Choisis deux concepts différents.", "error");
    return;
  }
  if (!RELATION_KEYS.includes(type)) return;

  currentGraphData.edges.push({
    id: `manual_${Date.now().toString(36)}`,
    source,
    target,
    type,
    confidence: 1,
    sourceQuote: "Relation ajoutée manuellement (pas de citation source).",
  });

  addRelationModalBackdrop.classList.remove("open");
  drawGraph();

  try {
    await persistGraphToDatabase();
    showToast("Relation ajoutée.", "success");
  } catch (err) {
    console.error("Erreur ajout relation:", err);
    showToast("Relation ajoutée localement, mais la sauvegarde a échoué.", "error");
  }
});
addRelationModalClose.addEventListener("click", () => addRelationModalBackdrop.classList.remove("open"));
addRelationModalBackdrop.addEventListener("click", (e) => {
  if (e.target === addRelationModalBackdrop) addRelationModalBackdrop.classList.remove("open");
});

// ============================================================
// Resizable panels
// ============================================================
initResizeHandle(document.getElementById("resizerLeft"), layoutEl, "--left-panel-width", "left", () => currentCy?.resize());
initResizeHandle(document.getElementById("resizerRight"), layoutEl, "--right-panel-width", "right", () => currentCy?.resize());

// الطول/العرض ديال panel-left / graph-stage / panel-right ثابت على حساب
// حجم الشاشة (grid + height:100%) — بصح Cytoscape خاصو "resize()" فاش
// كيتبدل حجم النافذة باش يعاود يحسب المساحة ديالو وما يبقاش مقصوص/فارغ.
window.addEventListener("resize", () => currentCy?.resize());

// ============================================================
// Utils
// ============================================================
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ============================================================
// Share Modal Logic (UI Toggle)
// ============================================================
const shareModalBackdrop = document.getElementById("shareModalBackdrop");
const openShareModalBtn = document.getElementById("openShareModalBtn");
const shareModalClose = document.getElementById("shareModalClose");

openShareModalBtn.addEventListener("click", () => {
    shareModalBackdrop.classList.add("open");
});

function closeShareModal() {
    shareModalBackdrop.classList.remove("open");
    document.getElementById("shareStatusMsg").style.display = "none";
    document.getElementById("shareEmail").value = "";
}

shareModalClose.addEventListener("click", closeShareModal);
shareModalBackdrop.addEventListener("click", (e) => {
    if (e.target === shareModalBackdrop) closeShareModal();
});


// ============================================================
// Logique de Partage (Appwrite Teams & Permissions) - CORRIGÉ
// ============================================================
const confirmShareBtn = document.getElementById("confirmShareBtn");
const shareStatusMsg = document.getElementById("shareStatusMsg");

confirmShareBtn.addEventListener("click", async () => {
    const email = document.getElementById("shareEmail").value.trim();
    const role = document.getElementById("shareRole").value; 
    
    const urlParams = new URLSearchParams(window.location.search);
    const currentGraphId = urlParams.get('graphId');

    if (!email || !currentGraphId) {
        alert("Erreur: Adresse email ou ID du graphe manquant.");
        return;
    }

    shareStatusMsg.style.display = "block";
    shareStatusMsg.style.color = "var(--text-primary)";
    shareStatusMsg.textContent = "Création des accès et envoi de l'email...";
    confirmShareBtn.disabled = true;

    try {
        const viewerTeamId = "v_" + currentGraphId;
        const editorTeamId = "e_" + currentGraphId;

        try { await teams.get(viewerTeamId); } 
        catch (e) { await teams.create(viewerTeamId, "Viewers - Graphe: " + currentGraphId); }

        try { await teams.get(editorTeamId); } 
        catch (e) { await teams.create(editorTeamId, "Editors - Graphe: " + currentGraphId); }

        await databases.updateDocument(
            DATABASE_ID, 
            COLLECTION_ID, 
            currentGraphId, 
            undefined, 
            [
                Permission.read(Role.user(currentUser.$id)),
                Permission.update(Role.user(currentUser.$id)),
                Permission.delete(Role.user(currentUser.$id)),
                Permission.read(Role.team(viewerTeamId)),  
                Permission.read(Role.team(editorTeamId)),  
                Permission.update(Role.team(editorTeamId)) 
            ]
        );

        const redirectUrl = window.location.origin + '/index.html?graphId=' + currentGraphId;
        const targetTeamId = role === 'viewer' ? viewerTeamId : editorTeamId;

        // التعديل كاين هنا: زدنا undefined ديال userId باش الترتيب يتقاد
        await teams.createMembership(
            targetTeamId,     // 1. teamId
            [],               // 2. roles
            email,            // 3. email
            undefined,        // 4. userId
            undefined,        // 5. phone
            redirectUrl,      // 6. url
            undefined         // 7. name (خليناها undefined باش مايحسبهاش خاوية)
        );

        shareStatusMsg.style.color = "#8fbf7f"; 
        shareStatusMsg.textContent = `Invitation envoyée avec succès à ${email} en tant que ${role} !`;
        document.getElementById("shareEmail").value = "";

    } catch (err) {
        console.error("Erreur de partage:", err);
        shareStatusMsg.style.color = "#e06b6b"; 
        shareStatusMsg.textContent = "Erreur: " + err.message;
    } finally {
        confirmShareBtn.disabled = false;
    }
});
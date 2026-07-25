// ============================================================
// app.js — the only file that touches the DOM directly.
// It knows nothing about how extraction/graph-building, relation
// aggregation, source lookup, chat, export or resizing WORK
// internally — each of those lives in its own pure/network module
// with a clear input → output mold. This file only wires DOM
// events to those modules' functions and passes data through.
// ============================================================

import { runtimeAuth, RELATION_TYPES, DEFAULT_CONFIDENCE_THRESHOLD } from "./config.js";
import { extractPdfPages, wrapPastedText } from "./pdfReader.js";
import { execute as runPipeline } from "./pipeline.js";
import { render as renderGraph } from "./graphRenderer.js";
import { getNodeRelations } from "./graphQueries.js";
import { computeLearningPath } from "./learningPath.js";
import { findSection, findSectionByQuote, highlightQuote } from "./sourceView.js";
import { askAboutConcept } from "./chatClient.js";
import { exportGraphToPdf } from "./graphExporter.js";
import { initResizeHandle } from "./resizablePanels.js";

// ============================================================
// Auth & Route Protection (Appwrite)
// ============================================================
// حيت حنا فـ module، Appwrite كنجبدوها من window
const { Client, Account, Databases, ID } = window.Appwrite;
const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6a6406f5003a13231358'); 

const account = new Account(client);
const databases = new Databases(client);


const DATABASE_ID = '6a64b2d8001b82e7f4dd'; 
const COLLECTION_ID = 'userid'

let currentUser = null;
const urlParams = new URLSearchParams(window.location.search);
const graphId = urlParams.get('graphId');

// تأكد واش مكونيكطي واحتفظ باليوزر باش نربطو بيه المبيان
account.get()
    .then(async (response) => {
        currentUser = response;
        document.body.style.display = 'block'; 
        document.getElementById('userNameDisplay').textContent = response.name || response.email || 'Utilisateur';

        // 2. إيلا كان graphId فـ URL، جبد ديك الداتا من Appwrite ورسمها نيشان!
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
        setStage("Chargement du graphe...", "active");
        emptyState.style.display = "block";
        emptyState.textContent = "Récupération du graphe...";

        const document = await databases.getDocument(
            DATABASE_ID,
            COLLECTION_ID,
            id
        );

        // تحويل النص المخزن إلى JSON Object ديال nodes و edges
        const parsedData = JSON.parse(document.graphData);
        currentGraphData = parsedData;

        // تفعيل الأزرار والواجهة
        setStage(`Chargé avec succès — ${currentGraphData.nodes.length} concepts`, "done");
        emptyState.style.display = "none";
        thresholdSlider.disabled = false;
        learningPathBtn.disabled = false;
        exportPdfBtn.disabled = false;
        arrangeGraphBtn.disabled = false;

        // رسم المبيان
        drawGraph();

    } catch (err) {
        console.error("Erreur chargement graphe:", err);
        setStage("Erreur de chargement du graphe", "error");
        emptyState.textContent = "Impossible de charger ce graphe.";
    }
}

// كنتأكدو واش اليوزر مكونيكطي قبل ما نخدمو التطبيق
account.get()
    .then((response) => {
        // اليوزر مكونيكطي: بين ليه التطبيق
        document.body.style.display = 'block'; 
        document.getElementById('userNameDisplay').textContent = response.name || 'Utilisateur';
    })
    .catch((error) => {
        // اليوزر مامكونيكطيش: صيفطو نيشان لـ login
        window.location.href = 'auth/login.html';
    });

// زر تسجيل الخروج
document.getElementById('logoutBtn').addEventListener('click', () => {
    account.deleteSession('current')
        .then(() => {
            window.location.href = 'auth/login.html';
        });
});

/* global pdfjsLib */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";

// ---- DOM refs ----
const apiKeyInput = document.getElementById("apiKey");
const dropzone = document.getElementById("dropzone");
const pdfInput = document.getElementById("pdfInput");
const pasteText = document.getElementById("pasteText");
const runBtn = document.getElementById("runBtn");
const stageLog = document.getElementById("stageLog");
const graphContainer = document.getElementById("graphContainer");
const emptyState = document.getElementById("emptyState");
const detailPanel = document.getElementById("detailPanel");
const thresholdSlider = document.getElementById("thresholdSlider");
const thresholdValue = document.getElementById("thresholdValue");
const legendEl = document.getElementById("legend");
const layoutEl = document.querySelector(".layout");

const learningPathBtn = document.getElementById("learningPathBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");

const sourceDrawer = document.getElementById("sourceDrawer");
const sourceDrawerBackdrop = document.getElementById("sourceDrawerBackdrop");
const sourceDrawerTitle = document.getElementById("sourceDrawerTitle");
const sourceDrawerBody = document.getElementById("sourceDrawerBody");
const sourceDrawerClose = document.getElementById("sourceDrawerClose");

const chatModalBackdrop = document.getElementById("chatModalBackdrop");
const chatModalTitle = document.getElementById("chatModalTitle");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatModalClose = document.getElementById("chatModalClose");

const pathModalBackdrop = document.getElementById("pathModalBackdrop");
const pathList = document.getElementById("pathList");
const pathCycleNote = document.getElementById("pathCycleNote");
const pathModalClose = document.getElementById("pathModalClose");
const arrangeGraphBtn = document.getElementById("arrangeGraphBtn");

// ---- app state ----
let selectedFile = null;
let currentGraphData = null;  // {nodes, edges} — stage 2 output, kept for slider/export/chat/path
let currentSections = null;   // stage 1 output — kept for "aller à la source" + chat context
let currentCy = null;         // live Cytoscape instance — kept for export + programmatic selection
let activeChatNode = null;    // which node the open chat modal is currently about

arrangeGraphBtn.disabled = false;

// --- 1. دالة ترتيب المبيان (Parcours Layout) ---
arrangeGraphBtn.addEventListener("click", () => {
  if (!currentCy) return;
  // كنخدمو خوارزمية breadthfirst لي كترتب الـ nodes من الفوق لتحت بحال الشجرة
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
// API key — memory only, never persisted (see README)
// ============================================================
apiKeyInput.addEventListener("input", () => {
  runtimeAuth.apiKey = apiKeyInput.value.trim();
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
  <li>
    <span class="swatch" style="background:${r.color};
      border-bottom:${r.lineStyle === "dashed" ? "2px dashed" + r.color : ""}"></span>
    ${r.label}
  </li>`
).join("");

// ============================================================
// Stage log
// ============================================================
function setStage(name, status) {
  stageLog.innerHTML = `<li class="${status}">${name}</li>`;
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

  runBtn.disabled = true;
  thresholdSlider.disabled = true;
  learningPathBtn.disabled = true;
  exportPdfBtn.disabled = true;
  emptyState.style.display = "block";
  emptyState.textContent = "Extraction en cours...";
  resetDetailPanel();

  try {
    const pages = selectedFile
      ? await extractPdfPages(selectedFile)
      : wrapPastedText(pasteText.value);

    const context = {
      apiKey: runtimeAuth.apiKey,
      onProgress: (msg) => setStage(msg, "active"),
    };

    // pipeline.execute() now returns EVERY stage's output keyed by name
    // (not just the last one) — we need stage "extraction"'s sections
    // later for "aller à la source" and the concept chat, alongside
    // stage "graph"'s final {nodes, edges}. Each stage itself still only
    // ever sees the previous stage's output, unchanged.
    const results = await runPipeline(pages, context);
    currentSections = results.extraction;
    currentGraphData = results.graph;

    try {
      setStage("Sauvegarde en cours...", "active");
      
      const graphTitle = selectedFile ? selectedFile.name.replace('.pdf', '') : 'Texte collé';
      
      await databases.createDocument(
        DATABASE_ID,
        COLLECTION_ID,
        ID.unique(),
        {
          userId: currentUser.$id,
          title: graphTitle,
          icon: '📄', // يقدر يكون إيموجي افتراضي
          sourceCount: 1,
          graphData: JSON.stringify(currentGraphData) // كنحولو المبيان لـ Text باش يتحفظ
        }
      );
      setStage(`Terminé et sauvegardé — ${currentGraphData.nodes.length} concepts`, "done");
    } catch (saveError) {
      console.error("Erreur de sauvegarde:", saveError);
      setStage("Terminé, mais erreur de sauvegarde", "error");
    }
    // ----------------------------------------------------

    emptyState.style.display = "none";
    thresholdSlider.disabled = false;
    learningPathBtn.disabled = false;
    exportPdfBtn.disabled = false;
    arrangeGraphBtn.disabled = false;

    drawGraph();

    setStage(`Terminé — ${currentGraphData.nodes.length} concepts, ${currentGraphData.edges.length} relations`, "done");
    emptyState.style.display = "none";
    thresholdSlider.disabled = false;
    learningPathBtn.disabled = false;
    exportPdfBtn.disabled = false;

    drawGraph();
  } catch (err) {
    setStage(err.message, "error");
    emptyState.style.display = "block";
    emptyState.textContent = "Une erreur est survenue — voir le détail dans le pipeline à gauche.";
  } finally {
    runBtn.disabled = false;
  }
});

// ============================================================
// Confidence slider
// ============================================================
thresholdSlider.addEventListener("input", () => {
  thresholdValue.textContent = Number(thresholdSlider.value).toFixed(2);
  if (currentGraphData) drawGraph();
});

function drawGraph() {
  const threshold = Number(thresholdSlider.value) || DEFAULT_CONFIDENCE_THRESHOLD;
  currentCy = renderGraph(currentGraphData, graphContainer, {
    confidenceThreshold: threshold,
    onNodeClick: showNodeDetail,
    onEdgeClick: showEdgeDetail,
  });
}

// ============================================================
// Detail panel — node (definition + aggregated relations)
// ============================================================
function showNodeDetail(node) {
  activeChatNode = node;
  const relations = getNodeRelations(node.id, currentGraphData);

  // هنا كنستهدفو غير .detail-content، الـ Chat كيبقى فبلاصتو لتحت
  const detailContent = document.getElementById("detailPanel");
  detailContent.innerHTML = `
    <h2>Détails</h2>
    <div class="detail-card">
      <h3>${escapeHtml(node.label)}</h3>
      <p>${escapeHtml(node.definition)}</p>
      <p class="field-label">Source (section ${escapeHtml(node.sourceSectionId)})</p>
      <p class="quote">"${escapeHtml(node.sourceQuote)}"</p>
      <span class="source-link" data-role="go-to-source">Voir dans le texte source →</span>

      ${renderRelationsBlock("Ce que ce concept implique / produit", relations.outgoing)}
      ${renderRelationsBlock("Ce qui mène à ce concept", relations.incoming)}
    </div>`;

  detailContent
    .querySelector('[data-role="go-to-source"]')
    ?.addEventListener("click", () => openSourceDrawer({ sectionId: node.sourceSectionId, quote: node.sourceQuote }));
}

async function handleChat() {
  const question = chatInput.value.trim();
  if (!question) return;
  
  if (!activeChatNode) {
    alert("Veuillez d'abord cliquer sur un concept dans le graphe.");
    return;
  }
  
  if (!runtimeAuth.apiKey) {
    alert("Colle ta clé API Mistral en haut à droite d'abord.");
    return;
  }

  appendMessage("user", question);
  chatInput.value = "";
  chatSendBtn.disabled = true;

  const pendingEl = appendMessage("assistant pending", "Réflexion en cours...");

  try {
    const section = findSection(currentSections, activeChatNode.sourceSectionId);
    const answer = await askAboutConcept({
      apiKey: runtimeAuth.apiKey,
      node: activeChatNode,
      sectionText: section?.text,
      question,
    });
    pendingEl.remove();
    appendMessage("assistant", answer);
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

chatSendBtn.addEventListener("click", handleChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleChat();
});

function appendInlineMessage(container, cssClass, text) {
  const el = document.createElement("div");
  el.className = `chat-msg ${cssClass}`;
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
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
// Detail panel — edge
// ============================================================
function showEdgeDetail(edge) {
  activeChatNode = null;
  const relType = RELATION_TYPES.find((r) => r.key === edge.type);
  detailPanel.innerHTML = `
    <h2>Détails</h2>
    <div class="detail-card">
      <h3>${relType?.label ?? edge.type}</h3>
      <p class="field-label">Relation</p>
      <p>${escapeHtml(edge.source)} → ${escapeHtml(edge.target)}</p>
      <p class="field-label">Confiance</p>
      <div class="confidence-bar"><div class="confidence-fill" style="width:${edge.confidence * 100}%"></div></div>
      <p class="field-label">Source</p>
      <p class="quote">"${escapeHtml(edge.sourceQuote)}"</p>
      <span class="source-link" data-role="go-to-source">Voir dans le texte source →</span>
    </div>`;

  // Edges don't carry a sourceSectionId in the current graph schema
  // (only nodes do — see graphStage.js) — openSourceDrawer falls back
  // to searching every section for the quote when sectionId is omitted.
  detailPanel
    .querySelector('[data-role="go-to-source"]')
    ?.addEventListener("click", () => openSourceDrawer({ quote: edge.sourceQuote }));
}

function resetDetailPanel() {
  detailPanel.innerHTML = `<h2>Détails</h2><p class="empty-hint">Clique sur un nœud ou une relation pour voir sa source.</p>`;
}

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
// Source drawer — "aller à la source"
// ============================================================
function openSourceDrawer({ sectionId, quote }) {
  if (!currentSections) return;

  const section = sectionId
    ? findSection(currentSections, sectionId)
    : findSectionByQuote(currentSections, quote);

  if (!section) {
    sourceDrawerTitle.textContent = "Source introuvable";
    sourceDrawerBody.innerHTML = `<p class="empty-hint">Impossible de retrouver ce passage dans le texte source.</p>`;
  } else {
    sourceDrawerTitle.textContent = `${section.id} — ${section.heading}`;
    const { chunks } = highlightQuote(section.text, quote);
    sourceDrawerBody.innerHTML = chunks
      .map((c) => (c.highlight ? `<mark>${escapeHtml(c.text)}</mark>` : escapeHtml(c.text)))
      .join("");
  }

  sourceDrawer.classList.add("open");
  sourceDrawerBackdrop.classList.add("open");
  sourceDrawerBody.querySelector("mark")?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function closeSourceDrawer() {
  sourceDrawer.classList.remove("open");
  sourceDrawerBackdrop.classList.remove("open");
}
sourceDrawerClose.addEventListener("click", closeSourceDrawer);
sourceDrawerBackdrop.addEventListener("click", closeSourceDrawer);

// ============================================================
// Chat modal — "Demander à l'IA"
// ============================================================
function openChatModal(node) {
  activeChatNode = node;
  chatModalTitle.textContent = `À propos de : ${node.label}`;
  chatMessages.innerHTML = "";
  chatInput.value = "";
  chatModalBackdrop.classList.add("open");
  chatInput.focus();
}

function closeChatModal() {
  chatModalBackdrop.classList.remove("open");
}
chatModalClose.addEventListener("click", closeChatModal);
chatModalBackdrop.addEventListener("click", (e) => {
  if (e.target === chatModalBackdrop) closeChatModal();
});

async function sendChatMessage() {
  const question = chatInput.value.trim();
  if (!question) return;
  
  if (!activeChatNode) {
    alert("Veuillez d'abord cliquer sur un concept dans le graphe.");
    return;
  }
  
  if (!runtimeAuth.apiKey) {
    alert("Colle ta clé API Mistral en haut à droite d'abord.");
    return;
  }

  appendChatMessage("user", question);
  chatInput.value = "";
  chatSendBtn.disabled = true;

  const pendingEl = appendChatMessage("assistant pending", "Réflexion en cours...");

  try {
    const section = findSection(currentSections, activeChatNode.sourceSectionId);
    const answer = await askAboutConcept({
      apiKey: runtimeAuth.apiKey,
      node: activeChatNode,
      sectionText: section?.text,
      question,
    });
    pendingEl.remove();
    appendChatMessage("assistant", answer);
  } catch (err) {
    pendingEl.remove();
    appendChatMessage("assistant error", `Erreur : ${err.message}`);
  } finally {
    chatSendBtn.disabled = false;
  }
}

chatSendBtn.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

function appendChatMessage(cssClass, text) {
  const el = document.createElement("div");
  el.className = `chat-msg ${cssClass}`;
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

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
  const originalLabel = exportPdfBtn.textContent;
  exportPdfBtn.textContent = "Export...";
  try {
    await exportGraphToPdf(currentCy, currentGraphData, { title: "Graphe de concepts" });
  } catch (err) {
    alert(`Échec de l'export PDF : ${err.message}`);
  } finally {
    exportPdfBtn.disabled = false;
    exportPdfBtn.textContent = originalLabel;
  }
});

// ============================================================
// Resizable panels
// ============================================================
initResizeHandle(document.getElementById("resizerLeft"), layoutEl, "--left-panel-width", "left", () => currentCy?.resize());
initResizeHandle(document.getElementById("resizerRight"), layoutEl, "--right-panel-width", "right", () => currentCy?.resize());

// ============================================================
// Utils
// ============================================================
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

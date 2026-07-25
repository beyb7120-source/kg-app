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

        // تحويل النص المخزن إلى JSON Object ديال nodes و edges
        const parsedData = JSON.parse(doc.graphData);
        currentGraphData = parsedData;
        currentSections = null; // ماعندناش النص المصدر ديال المبيانات القديمة (غير nodes/edges)

        if (doc.title) graphTitleEl.textContent = doc.title;

        emptyState.style.display = "none";
        learningPathBtn.disabled = false;
        exportPdfBtn.disabled = false;
        arrangeGraphBtn.disabled = false;

        drawGraph();
    } catch (err) {
        console.error("Erreur chargement graphe:", err);
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
const arrangeGraphBtn = document.getElementById("arrangeGraphBtn");

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

  // إيلا كان المبيان محفوظ ديجا (عندو graphId فالـ URL)، صيفط التسمية الجديدة لـ Appwrite
  if (graphId) {
    try {
      await databases.updateDocument(DATABASE_ID, COLLECTION_ID, graphId, { title: newTitle });
    } catch (err) {
      console.error("Erreur renommage:", err);
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

  runBtn.disabled = true;
  learningPathBtn.disabled = true;
  exportPdfBtn.disabled = true;
  arrangeGraphBtn.disabled = true;
  closeNodePopup();
  setStage("Extraction en cours...", "active");

  try {
    const pages = selectedFile
      ? await extractPdfPages(selectedFile)
      : wrapPastedText(pasteText.value);

    const context = {
      apiKey: runtimeAuth.apiKey,
      onProgress: (msg) => setStage(msg, "active"),
    };

    // pipeline.execute() renvoie la sortie de CHAQUE étape, indexée par
    // nom — on a besoin des sections de l'étape "extraction" plus tard
    // pour "aller à la source" et le chat, en plus du graphe final.
    const results = await runPipeline(pages, context);
    currentSections = results.extraction;
    currentGraphData = results.graph;

    try {
      setStage("Sauvegarde en cours...", "active");

      const graphTitle = graphTitleEl.textContent.trim() ||
        (selectedFile ? selectedFile.name.replace(/\.pdf$/i, "") : "Texte collé");
      graphTitleEl.textContent = graphTitle;

      await databases.createDocument(
        DATABASE_ID,
        COLLECTION_ID,
        ID.unique(),
        {
          userId: currentUser.$id,
          title: graphTitle,
          icon: '📄',
          sourceCount: 1,
          graphData: JSON.stringify(currentGraphData)
        }
      );
    } catch (saveError) {
      console.error("Erreur de sauvegarde:", saveError);
    }

    learningPathBtn.disabled = false;
    exportPdfBtn.disabled = false;
    arrangeGraphBtn.disabled = false;

    emptyState.style.display = "none";
    drawGraph();
  } catch (err) {
    setStage(err.message, "error");
  } finally {
    runBtn.disabled = false;
  }
});

// ============================================================
// Graph rendering
// ============================================================
function drawGraph() {
  activeLegendType = null;
  legendEl.querySelectorAll("li").forEach((el) => el.classList.remove("active"));

  currentCy = renderGraph(currentGraphData, graphContainer, {
    confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
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

      <div class="detail-actions">
        <button data-role="ask-ai"><i class="fa-solid fa-robot"></i> Demander à l'IA</button>
        <button data-role="go-to-source"><i class="fa-solid fa-quote-right"></i> Voir dans le texte source</button>
      </div>
    </div>`;

  nodePopupBody.querySelector('[data-role="ask-ai"]')
    ?.addEventListener("click", () => openInlineChat(node));

  nodePopupBody.querySelector('[data-role="go-to-source"]')
    ?.addEventListener("click", () => showSourceInLeftPanel({ sectionId: node.sourceSectionId, quote: node.sourceQuote }));

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

      <div class="detail-actions">
        <button data-role="go-to-source"><i class="fa-solid fa-quote-right"></i> Voir dans le texte source</button>
      </div>
    </div>`;

  // Les edges n'ont pas de sourceSectionId dans le schéma actuel du graphe
  // (seuls les nodes en ont) — showSourceInLeftPanel cherche dans toutes
  // les sections par citation quand sectionId est absent.
  nodePopupBody.querySelector('[data-role="go-to-source"]')
    ?.addEventListener("click", () => showSourceInLeftPanel({ quote: edge.sourceQuote }));

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
// ============================================================
function openInlineChat(node) {
  activeChatNode = node;
  chatContextTitle.textContent = `À propos de : ${node.label}`;
  chatContextHint.style.display = "none";
  chatMessages.innerHTML = "";
  chatInput.focus();
  closeNodePopup();
}

async function handleChat() {
  const question = chatInput.value.trim();
  if (!question) return;

  if (!activeChatNode) {
    alert("Veuillez d'abord cliquer sur un concept dans le graphe, puis « Demander à l'IA ».");
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
    const section = currentSections ? findSection(currentSections, activeChatNode.sourceSectionId) : null;
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
  } catch (err) {
    alert(`Échec de l'export PDF : ${err.message}`);
  } finally {
    exportPdfBtn.disabled = false;
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
// ============================================================
// app.js — the only file that touches the DOM directly.
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
const { Client, Account, Databases, Teams, Permission, Role, Query, ID } = window.Appwrite;
const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6a667fe600130a273954');

const account = new Account(client);
const databases = new Databases(client);
const teams = new Teams(client);

const DATABASE_ID = '6a6682d6000846a6685e';
const COLLECTION_ID = 'kg-app';
const GRAPH_META_COLLECTION_ID = 'graph-meta';
const ACCESS_REQUESTS_COLLECTION_ID = 'access-requests';

function teamIdFor(id) { return "t_" + id; }

// ============================================================
// State Variables
// ============================================================
let currentUser = null;
const urlParams = new URLSearchParams(window.location.search);
const graphId = urlParams.get('graphId');
let currentDbId = graphId;

let isOwner = true;
let currentGraphOwnerId = null;
let currentUserRole = 'owner';

function updateAccessButtonsVisibility() {
    document.getElementById('openShareModalBtn').style.display = isOwner ? 'block' : 'none';
    document.getElementById('openManageModalBtn').style.display = isOwner ? 'block' : 'none';
    document.getElementById('leaveGraphBtn').style.display = !isOwner ? 'block' : 'none';
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    if (copyLinkBtn) copyLinkBtn.style.display = currentDbId ? 'block' : 'none';
}

const teamIdParam = urlParams.get('teamId');
const membershipIdParam = urlParams.get('membershipId');
const userIdParam = urlParams.get('userId');
const secretParam = urlParams.get('secret');

let currentGraphData = null;
let currentSections = null;
let currentCy = null;
let activeChatNode = null;
let currentConfidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD;
let currentSourceCount = 1;
let hasUnsavedFailure = false;

// Multi-Source State
let sourcesArray = []; 

// ============================================================
// DOM References
// ============================================================
const graphTitleEl = document.getElementById("graphTitle");
const apiKeyInput = document.getElementById("apiKey");
const runBtn = document.getElementById("runBtn");
const graphContainer = document.getElementById("graphContainer");
const emptyState = document.getElementById("emptyState");
const legendEl = document.getElementById("legend");
const layoutEl = document.querySelector(".layout");

// Multi-Source DOM Refs
const sourcesManager = document.getElementById("sourcesManager");
const sourcesListEl = document.getElementById("sourcesList");
const selectAllSourcesCheckbox = document.getElementById("selectAllSources");
const addSourceBtn = document.getElementById("addSourceBtn");
const addSourceModalBackdrop = document.getElementById("addSourceModalBackdrop");
const closeAddSourceModal = document.getElementById("closeAddSourceModal");

const uploadFilesBtn = document.getElementById("uploadFilesBtn");
const multiPdfInput = document.getElementById("multiPdfInput");

const copiedTextBtn = document.getElementById("copiedTextBtn");
const copiedTextModalBackdrop = document.getElementById("copiedTextModalBackdrop");
const closeCopiedTextModal = document.getElementById("closeCopiedTextModal");
const backFromCopiedText = document.getElementById("backFromCopiedText");
const insertCopiedTextBtn = document.getElementById("insertCopiedTextBtn");
const copiedTextInput = document.getElementById("copiedTextInput");

const websitesBtn = document.getElementById("websitesBtn");
const websitesModalBackdrop = document.getElementById("websitesModalBackdrop");
const closeWebsitesModal = document.getElementById("closeWebsitesModal");
const backFromWebsites = document.getElementById("backFromWebsites");
const insertWebsitesBtn = document.getElementById("insertWebsitesBtn");
const websitesInput = document.getElementById("websitesInput");

const driveBtn = document.getElementById("driveBtn");

const sourceResultBlock = document.getElementById("sourceResultBlock");
const closeSourceResultBtn = document.getElementById("closeSourceResultBtn");
const sourceResult = document.getElementById("sourceResult");

// Export & Panels DOM Refs
const learningPathBtn = document.getElementById("learningPathBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const statsBtn = document.getElementById("statsBtn");
const arrangeGraphBtn = document.getElementById("arrangeGraphBtn");
const confidenceSlider = document.getElementById("confidenceSlider");
const confidenceValue = document.getElementById("confidenceValue");
const jsonImportInput = document.getElementById("jsonImportInput");
const importJsonBtn = document.getElementById("importJsonBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");

// Modals DOM Refs
const statsModalBackdrop = document.getElementById("statsModalBackdrop");
const statsModalBody = document.getElementById("statsModalBody");
const statsModalClose = document.getElementById("statsModalClose");

const addRelationModalBackdrop = document.getElementById("addRelationModalBackdrop");
const addRelationModalClose = document.getElementById("addRelationModalClose");
const addRelationForm = document.getElementById("addRelationForm");
const relationFromSelect = document.getElementById("relationFromSelect");
const relationTypeSelect = document.getElementById("relationTypeSelect");
const relationToSelect = document.getElementById("relationToSelect");

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

// Share/Access DOM Refs
const shareModalBackdrop = document.getElementById("shareModalBackdrop");
const openShareModalBtn = document.getElementById("openShareModalBtn");
const shareModalClose = document.getElementById("shareModalClose");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const confirmShareBtn = document.getElementById("confirmShareBtn");
const shareStatusMsg = document.getElementById("shareStatusMsg");
const manageModalBackdrop = document.getElementById("manageModalBackdrop");
const openManageModalBtn = document.getElementById("openManageModalBtn");
const manageModalClose = document.getElementById("manageModalClose");
const membersList = document.getElementById("membersList");
const leaveGraphBtn = document.getElementById("leaveGraphBtn");
const requestAccessModalBackdrop = document.getElementById("requestAccessModalBackdrop");
const requestAccessModalClose = document.getElementById("requestAccessModalClose");

// ============================================================
// Initialization & Basic Events
// ============================================================
window.addEventListener("beforeunload", (e) => {
    if (hasUnsavedFailure) {
        e.preventDefault();
        e.returnValue = "";
    }
});

initThemeToggle(themeToggleBtn);
/* global pdfjsLib */
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

apiKeyInput.addEventListener("input", () => {
    runtimeAuth.apiKey = apiKeyInput.value.trim();
});

// ============================================================
// Multi-Source UI Logic
// ============================================================
addSourceBtn.addEventListener("click", () => addSourceModalBackdrop.classList.add("open"));
closeAddSourceModal.addEventListener("click", () => addSourceModalBackdrop.classList.remove("open"));

// Helper function: Close sub-modals
function closeSubModals() {
    copiedTextModalBackdrop.classList.remove("open");
    websitesModalBackdrop.classList.remove("open");
}

// Open Copied Text / Websites Modals
copiedTextBtn.addEventListener("click", () => {
    addSourceModalBackdrop.classList.remove("open");
    copiedTextModalBackdrop.classList.add("open");
});
websitesBtn.addEventListener("click", () => {
    addSourceModalBackdrop.classList.remove("open");
    websitesModalBackdrop.classList.add("open");
});

// Close Sub-Modals
closeCopiedTextModal.addEventListener("click", closeSubModals);
closeWebsitesModal.addEventListener("click", closeSubModals);

// Back Buttons
backFromCopiedText.addEventListener("click", () => {
    closeSubModals();
    addSourceModalBackdrop.classList.add("open");
});
backFromWebsites.addEventListener("click", () => {
    closeSubModals();
    addSourceModalBackdrop.classList.add("open");
});

// File Upload Logic
uploadFilesBtn.addEventListener("click", () => multiPdfInput.click());
multiPdfInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
        sourcesArray.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            name: file.name,
            type: 'pdf',
            data: file, 
            selected: true
        });
    });
    addSourceModalBackdrop.classList.remove("open");
    renderSourcesList();
});

// Copied Text Logic
insertCopiedTextBtn.addEventListener("click", () => {
    const text = copiedTextInput.value.trim();
    if (text) {
        sourcesArray.push({
            id: Date.now().toString(36),
            name: "Texte copié " + new Date().toLocaleTimeString(),
            type: 'text',
            data: text,
            selected: true
        });
        copiedTextInput.value = "";
        closeSubModals();
        renderSourcesList();
    }
});

// Websites Logic
insertWebsitesBtn.addEventListener("click", () => {
    const urls = websitesInput.value.trim().split(/\s+/).filter(u => u); 
    if (urls.length > 0) {
        urls.forEach(url => {
            sourcesArray.push({
                id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
                name: url,
                type: 'url',
                data: url,
                selected: true
            });
        });
        websitesInput.value = "";
        closeSubModals();
        renderSourcesList();
    }
});


// Google Drive Link Logic (ساهل، نقي، وماكيطلبش Google Verification)
const driveLinkBtn = document.getElementById("driveLinkBtn"); // تأكد من الاسم الجديد

driveLinkBtn.addEventListener("click", () => {
    addSourceModalBackdrop.classList.remove("open");
    const link = prompt("Collez le lien de partage Google Drive (Document / PDF) :");
    if (link && link.trim() !== "") {
        sourcesArray.push({
            id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
            name: "Google Drive File (" + link.substring(0, 20) + "...)",
            type: 'url', // كيعاملو بحال الرابط
            data: link,
            selected: true
        });
        renderSourcesList();
        showToast("Lien Google Drive ajouté avec succès.", "success");
    }
});

// Render Sources List
function renderSourcesList() {
    sourcesListEl.innerHTML = "";
    sourcesArray.forEach(source => {
        const li = document.createElement("li");
        li.innerHTML = `
            <div class="source-info">
                <i class="fa-solid ${source.type === 'pdf' ? 'fa-file-pdf' : 'fa-align-left'}"></i>
                <span class="source-name">${escapeHtml(source.name)}</span>
            </div>
            <div class="source-actions">
                <div class="dropdown">
                    <button class="dots-btn" onclick="toggleDropdown('${source.id}')"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                    <div id="dropdown-${source.id}" class="dropdown-content">
                        <button onclick="renameSource('${source.id}')"><i class="fa-solid fa-pen"></i> Rename source</button>
                        <button onclick="removeSource('${source.id}')"><i class="fa-solid fa-trash"></i> Remove source</button>
                    </div>
                </div>
                <input type="checkbox" class="source-checkbox" data-id="${source.id}" ${source.selected ? "checked" : ""}>
            </div>
        `;
        sourcesListEl.appendChild(li);
    });

    document.querySelectorAll(".source-checkbox").forEach(checkbox => {
        checkbox.addEventListener("change", (e) => {
            const id = e.target.getAttribute("data-id");
            const source = sourcesArray.find(s => s.id === id);
            if (source) source.selected = e.target.checked;
            updateSelectAllState();
        });
    });
}

selectAllSourcesCheckbox.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    sourcesArray.forEach(s => s.selected = isChecked);
    renderSourcesList();
});

function updateSelectAllState() {
    const allSelected = sourcesArray.length > 0 && sourcesArray.every(s => s.selected);
    selectAllSourcesCheckbox.checked = allSelected;
}

window.toggleDropdown = function(id) {
    document.querySelectorAll('.dropdown-content').forEach(d => d.classList.remove('show'));
    document.getElementById(`dropdown-${id}`).classList.toggle('show');
};

window.removeSource = function(id) {
    sourcesArray = sourcesArray.filter(s => s.id !== id);
    renderSourcesList();
};

window.renameSource = function(id) {
    const source = sourcesArray.find(s => s.id === id);
    if (!source) return;
    const newName = prompt("Nouveau nom de la source :", source.name);
    if (newName && newName.trim() !== "") {
        source.name = newName.trim();
        renderSourcesList();
    }
};

window.showSourceInLeftPanel = function({ sectionId, quote }) {
    sourcesManager.style.display = "none";
    sourceResultBlock.style.display = "flex";

    if (!currentSections) {
        sourceResult.innerHTML = `<p class="empty-hint">Le texte source n'est pas disponible...</p>`;
    } else {
        const section = sectionId
            ? findSection(currentSections, sectionId)
            : findSectionByQuote(currentSections, quote);

        if (!section) {
            sourceResult.innerHTML = `<p class="empty-hint">Impossible de retrouver ce passage...</p>`;
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
};

closeSourceResultBtn.addEventListener("click", () => {
    sourceResultBlock.style.display = "none";
    sourcesManager.style.display = "flex";
});


// ============================================================
// Appwrite Auth & Initialization
// ============================================================
account.get()
    .then(async (response) => {
        currentUser = response;
        document.body.style.display = 'block'; 
        document.getElementById('userNameDisplay').textContent = response.name || response.email || 'Utilisateur';

        if (teamIdParam && membershipIdParam && userIdParam && secretParam) {
            try {
                await teams.updateMembershipStatus(teamIdParam, membershipIdParam, userIdParam, secretParam);
                alert("Vous avez rejoint l'équipe de ce graphe avec succès !");
                window.history.replaceState({}, document.title, window.location.pathname + "?graphId=" + graphId);
            } catch (err) {
                console.error("Erreur d'acceptation de l'invitation:", err);
                alert("L'invitation a expiré ou est invalide.");
            }
        }

        if (graphId) {
            await loadGraphFromDB(graphId);
        }
    })
    .catch((error) => {
        if (teamIdParam) {
            localStorage.setItem('pendingInviteUrl', window.location.href);
        }
        window.location.href = 'auth/login.html';
    });

document.getElementById('logoutBtn').addEventListener('click', () => {
    account.deleteSession('current')
        .then(() => {
            window.location.href = 'auth/login.html';
        });
});

// ============================================================
// Graph Data Logic
// ============================================================
async function loadGraphFromDB(id) {
    try {
        emptyState.style.display = "block";
        emptyState.textContent = "Récupération du graphe...";

        const doc = await databases.getDocument(DATABASE_ID, COLLECTION_ID, id);

        isOwner = doc.userId === currentUser.$id;
        let hasAccess = isOwner;
        if (!hasAccess) {
            try {
                const members = await teams.listMemberships(teamIdFor(id));
                hasAccess = members.memberships.some(m => m.userId === currentUser.$id && m.confirm);
            } catch { }
        }
        if (!hasAccess) {
            await showRequestAccessModal(id);
            emptyState.style.display = "block";
            emptyState.textContent = "Accès requis.";
            return;
        }

        currentDbId = id;
        currentSourceCount = doc.sourceCount || 1;

        const parsedData = JSON.parse(doc.graphData);
        currentGraphData = parsedData;

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

        updateAccessButtonsVisibility();
        currentGraphOwnerId = doc.userId;
        subscribeToOwnMembership(id);
        subscribeToGraphContent(id);
        if (isOwner) startPendingRequestsWatch(id);

        drawGraph();
    } catch (err) {
        console.error("Erreur chargement graphe:", err);
        if (err.code === 401 || err.code === 403) {
            await showRequestAccessModal(id);
        } else {
            showToast("Impossible de charger ce graphe.", "error");
        }
        emptyState.style.display = "block";
        emptyState.textContent = "Impossible de charger ce graphe.";
    }
}

async function persistGraphToDatabase() {
  const graphTitle = graphTitleEl.textContent.trim() ||
  (sourcesArray.length > 0 ? sourcesArray[0].name.replace(/\.pdf$/i, "") : "Nouveau graphe");
  graphTitleEl.textContent = graphTitle;

  const payload = {
    userId: currentUser.$id,
    title: graphTitle,
    icon: '📄',
    sourceCount: currentSourceCount,
    graphData: JSON.stringify(currentGraphData ?? {}),
    sections: JSON.stringify(currentSections ?? null),
  };

  try {
    if (!currentDbId) {
      const doc = await databases.createDocument(DATABASE_ID, COLLECTION_ID, ID.unique(), payload);
      currentDbId = doc.$id;
      const url = new URL(window.location.href);
      url.searchParams.set('graphId', currentDbId);
      window.history.replaceState({}, '', url);
    } else {
      await databases.updateDocument(DATABASE_ID, COLLECTION_ID, currentDbId, payload);
    }
    upsertGraphMeta(graphTitle).catch(e => console.error("graph-meta upsert:", e));
    hasUnsavedFailure = false;
  } catch (err) {
    hasUnsavedFailure = true;
    throw err;
  }
}

async function upsertGraphMeta(title) {
  const payload = { title, ownerId: currentUser.$id, icon: '📄' };
  try {
    await databases.createDocument(DATABASE_ID, GRAPH_META_COLLECTION_ID, currentDbId, payload, [
      Permission.read(Role.users()),     
      Permission.write(Role.user(currentUser.$id)),
    ]);
  } catch (e) {
    if (e.code === 409) {
      await databases.updateDocument(DATABASE_ID, GRAPH_META_COLLECTION_ID, currentDbId, payload);
    } else {
      throw e;
    }
  }
}

// ============================================================
// Graph Title Edit
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
// Pipeline Run
// ============================================================
function setStage(message, status) {
  emptyState.style.display = "block";
  emptyState.textContent = message;
  emptyState.classList.toggle("error", status === "error");
}

runBtn.addEventListener("click", async () => {
    if (!runtimeAuth.apiKey) {
        alert("Colle ta clé API Mistral d'abord.");
        return;
    }

    const selectedSources = sourcesArray.filter(s => s.selected);
    if (selectedSources.length === 0) {
        alert("Sélectionnez au moins une source pour générer le graphe.");
        return;
    }

    runBtn.disabled = true;
    closeNodePopup();
    setStage("Extraction des sources sélectionnées...", "active");

    try {
        let allPages = [];
        
        for (const source of selectedSources) {
            if (source.type === 'pdf') {
                const pages = await extractPdfPages(source.data);
                allPages = allPages.concat(pages);
            } else if (source.type === 'text') {
                const pages = wrapPastedText(source.data);
                allPages = allPages.concat(pages);
            } else if (source.type === 'url' || source.type === 'drive') {
                const pages = wrapPastedText(`[Contenu de la source externe non implémenté localement: ${source.name}]`);
                allPages = allPages.concat(pages);
            }
        }

        const context = {
            apiKey: runtimeAuth.apiKey,
            onProgress: (msg) => setStage(msg, "active"),
            onStageComplete: async (stageName, output) => {
                if (stageName === "extraction") {
                    currentSections = output;
                } else if (stageName === "graph") {
                    currentGraphData = output;
                }
                try {
                    await persistGraphToDatabase();
                } catch (saveError) {
                    hasUnsavedFailure = true;
                    console.error("Erreur de sauvegarde:", saveError);
                }
            }
        };

        const results = await runPipeline(allPages, context);
        currentSections = results.extraction;
        currentGraphData = results.graph;

        emptyState.style.display = "none";
        drawGraph();
        showToast("Graphe généré avec succès.", "success");

        updateAccessButtonsVisibility();
        if (currentDbId && !unsubscribeGraphContent) subscribeToGraphContent(currentDbId);

    } catch (err) {
        setStage(err.message, "error");
        showToast(err.message, "error");
    } finally {
        runBtn.disabled = false;
    }
});

// ============================================================
// UI Utilities (Layout, Graph interactions, Chat, Export)
// ============================================================
arrangeGraphBtn.addEventListener("click", () => {
  if (!currentCy) return;
  currentCy.layout({
    name: "breadthfirst", directed: true, spacingFactor: 1.2, padding: 30, animate: true, animationDuration: 600
  }).run();
});

legendEl.innerHTML = RELATION_TYPES.map(
  (r) => `<li data-type="${r.key}"><span class="swatch" style="background:${r.color}; border-bottom:${r.lineStyle === "dashed" ? "2px dashed" + r.color : ""}"></span>${r.label}</li>`
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

function applyLegendFilter(type) {
  if (!currentCy) return;
  currentCy.elements().removeClass("legend-dim legend-highlight");
  if (!type) return;
  const matchingEdges = currentCy.edges(`[type = "${type}"]`);
  const touchedNodeIds = new Set();
  matchingEdges.forEach((e) => { touchedNodeIds.add(e.data("source")); touchedNodeIds.add(e.data("target")); });
  currentCy.edges().difference(matchingEdges).addClass("legend-dim");
  currentCy.nodes().forEach((n) => { n.addClass(touchedNodeIds.has(n.id()) ? "legend-highlight" : "legend-dim"); });
  matchingEdges.addClass("legend-highlight");
}

confidenceSlider.addEventListener("input", () => {
  currentConfidenceThreshold = Number(confidenceSlider.value) / 100;
  confidenceValue.textContent = `${confidenceSlider.value}%`;
  if (!currentGraphData) return;
  const cy = updateThreshold(currentGraphData, currentConfidenceThreshold, graphContainer, { onNodeClick: showNodeDetail, onEdgeClick: showEdgeDetail });
  if (cy) { currentCy = cy; currentCy.on("tap", (evt) => { if (evt.target === currentCy) closeNodePopup(); }); }
});

function drawGraph() {
  activeLegendType = null;
  legendEl.querySelectorAll("li").forEach((el) => el.classList.remove("active"));
  if (!activeChatNode) {
    chatContextHint.textContent = currentSections ? "Pose une question sur le document entier, ou clique sur un concept dans le graphe pour une question ciblée." : "Clique sur un concept dans le graphe, puis « Demander à l'IA ».";
  }
  currentCy = renderGraph(currentGraphData, graphContainer, {
    confidenceThreshold: currentConfidenceThreshold, onNodeClick: showNodeDetail, onEdgeClick: showEdgeDetail
  });
  currentCy.on("tap", (evt) => { if (evt.target === currentCy) closeNodePopup(); });
}

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
        <button data-role="go-to-source"><i class="fa-solid fa-quote-right"></i> Voir source</button>
        <button data-role="edit-node" class="editor-only"><i class="fa-solid fa-pen"></i> Modifier</button>
        <button data-role="add-relation" class="editor-only"><i class="fa-solid fa-link"></i> Ajouter relation</button>
      </div>
    </div>`;

  nodePopupBody.querySelector('[data-role="ask-ai"]')?.addEventListener("click", () => openInlineChat(node));
  nodePopupBody.querySelector('[data-role="go-to-source"]')?.addEventListener("click", () => window.showSourceInLeftPanel({ sectionId: node.sourceSectionId, quote: node.sourceQuote }));
  nodePopupBody.querySelector('[data-role="edit-node"]')?.addEventListener("click", () => { if (canEdit()) showNodeEditForm(node); else showToast("Lecture seule.", "error"); });
  nodePopupBody.querySelector('[data-role="add-relation"]')?.addEventListener("click", () => { if (canEdit()) openAddRelationModal(node.id); else showToast("Lecture seule.", "error"); });
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
    if (!canEdit()) return;
    const newLabel = zone.querySelector("#editNodeLabel").value.trim();
    const newDefinition = zone.querySelector("#editNodeDefinition").value.trim();
    if (!newLabel) return;
    node.label = newLabel;
    node.definition = newDefinition;
    currentCy?.$id(node.id).data({ label: newLabel, definition: newDefinition });
    showNodeDetail(node);
    try { await persistGraphToDatabase(); showToast("Concept mis à jour.", "success"); } 
    catch (err) { showToast("Modifié localement, échec sauvegarde.", "error"); }
  });
}

function renderRelationsBlock(title, groups) {
  if (!groups.length) return "";
  return `<div class="relations-block"><h4>${escapeHtml(title)}</h4>${groups.map((g) => `<div class="relation-group"><div class="relation-type-label" style="color:${g.color}">${escapeHtml(g.label)}</div><div class="chip-list">${g.items.map((item) => `<span class="chip" data-node-id="${item.node.id}">${escapeHtml(item.node.label)}</span>`).join("")}</div></div>`).join("")}</div>`;
}

function showEdgeDetail(edge) {
  const relType = RELATION_TYPES.find((r) => r.key === edge.type);
  nodePopupBody.innerHTML = `
    <div class="detail-card">
      <h3>${relType?.label ?? edge.type}</h3><p class="field-label">Relation</p><p>${escapeHtml(edge.source)} → ${escapeHtml(edge.target)}</p>
      <p class="field-label">Confiance</p><div class="confidence-bar"><div class="confidence-fill" style="width:${edge.confidence * 100}%"></div></div>
      <p class="field-label">Source</p><p class="quote">"${escapeHtml(edge.sourceQuote)}"</p>
      <div id="edgeEditZone">
        <p class="field-label">Modifier le type</p>
        <select class="edit-field" id="editEdgeType">
          ${RELATION_TYPES.map((r) => `<option value="${r.key}" ${r.key === edge.type ? "selected" : ""}>${escapeHtml(r.label)}</option>`).join("")}
        </select>
      </div>
      <div class="detail-actions">
        <button data-role="go-to-source"><i class="fa-solid fa-quote-right"></i> Voir source</button>
        <button data-role="save-edge-type" class="editor-only"><i class="fa-solid fa-check"></i> Enregistrer</button>
        <button data-role="delete-edge" class="danger-action editor-only"><i class="fa-solid fa-trash"></i> Supprimer</button>
      </div>
    </div>`;

  nodePopupBody.querySelector('[data-role="go-to-source"]')?.addEventListener("click", () => window.showSourceInLeftPanel({ quote: edge.sourceQuote }));
  nodePopupBody.querySelector('[data-role="save-edge-type"]')?.addEventListener("click", async () => {
    if (!canEdit()) return;
    const newType = nodePopupBody.querySelector("#editEdgeType").value;
    if (!RELATION_KEYS.includes(newType) || newType === edge.type) return;
    edge.type = newType; drawGraph();
    try { await persistGraphToDatabase(); showToast("Type mis à jour.", "success"); } 
    catch (err) { showToast("Modifié localement, échec sauvegarde.", "error"); }
  });
  nodePopupBody.querySelector('[data-role="delete-edge"]')?.addEventListener("click", async () => {
    if (!canEdit()) return;
    if (!confirm("Supprimer cette relation ?")) return;
    currentGraphData.edges = currentGraphData.edges.filter((e) => e.id !== edge.id);
    closeNodePopup(); drawGraph();
    try { await persistGraphToDatabase(); showToast("Relation supprimée.", "success"); } 
    catch (err) { showToast("Erreur sauvegarde.", "error"); }
  });
  openNodePopup();
}

function openNodePopup() { nodePopupBackdrop.classList.add("open"); }
function closeNodePopup() { nodePopupBackdrop.classList.remove("open"); }
nodePopupClose.addEventListener("click", closeNodePopup);
nodePopupBackdrop.addEventListener("click", (e) => { if (e.target === nodePopupBackdrop) closeNodePopup(); });
function selectNodeInGraph(nodeId) {
  if (!currentCy) return;
  currentCy.elements().unselect();
  const ele = currentCy.$id(nodeId);
  if (ele.length) { ele.select(); currentCy.animate({ center: { eles: ele } }, { duration: 300 }); }
}

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
  chatContextHint.textContent = currentSections ? "Pose une question sur le document entier..." : "Clique sur un concept...";
  chatInput.focus();
}

async function handleChat() {
  const question = chatInput.value.trim();
  if (!question) return;
  if (!runtimeAuth.apiKey) { alert("Colle ta clé API Mistral."); return; }
  const useConceptMode = !!activeChatNode;
  if (!useConceptMode && !currentSections) { alert("Lance une extraction d'abord."); return; }
  appendMessage("user", question);
  chatInput.value = ""; chatSendBtn.disabled = true;
  const pendingEl = appendMessage("assistant pending", "Réflexion en cours...");
  try {
    if (useConceptMode) {
      const section = currentSections ? findSection(currentSections, activeChatNode.sourceSectionId) : null;
      const answer = await askAboutConcept({ apiKey: runtimeAuth.apiKey, node: activeChatNode, sectionText: section?.text, question });
      pendingEl.remove(); appendMessage("assistant", answer);
    } else {
      const segments = await askAboutDocument({ apiKey: runtimeAuth.apiKey, sections: currentSections, question });
      pendingEl.remove(); appendSegmentedMessage("assistant", segments);
    }
  } catch (err) { pendingEl.remove(); appendMessage("assistant error", `Erreur : ${err.message}`); } 
  finally { chatSendBtn.disabled = false; }
}

function appendMessage(cssClass, text) {
  const el = document.createElement("div"); el.className = `chat-msg ${cssClass}`; el.textContent = text;
  chatMessages.appendChild(el); chatMessages.scrollTop = chatMessages.scrollHeight; return el;
}

function appendSegmentedMessage(cssClass, segments) {
  const el = document.createElement("div"); el.className = `chat-msg ${cssClass}`;
  segments.forEach((seg, i) => {
    const hasCitation = !!(seg.sourceQuote && seg.sectionId);
    const span = document.createElement("span"); span.textContent = seg.text;
    if (hasCitation) {
      span.className = "cite-mark"; span.title = "Cliquer pour voir le passage source"; span.setAttribute("role", "button"); span.tabIndex = 0;
      const openSource = () => window.showSourceInLeftPanel({ sectionId: seg.sectionId, quote: seg.sourceQuote });
      span.addEventListener("click", openSource);
      span.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSource(); } });
    }
    el.appendChild(span);
    if (i < segments.length - 1) el.appendChild(document.createTextNode(" "));
  });
  chatMessages.appendChild(el); chatMessages.scrollTop = chatMessages.scrollHeight; return el;
}

chatSendBtn.addEventListener("click", handleChat);
chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleChat(); });

learningPathBtn.addEventListener("click", () => {
  if (!currentGraphData) return;
  const { order, cycles } = computeLearningPath(currentGraphData);
  pathList.innerHTML = order.map((node) => `<li data-node-id="${node.id}">${escapeHtml(node.label)}</li>`).join("");
  pathList.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => {
      const node = currentGraphData.nodes.find((n) => n.id === li.dataset.nodeId);
      if (!node) return;
      closePathModal(); selectNodeInGraph(node.id); showNodeDetail(node);
    });
  });
  if (cycles.length) { pathCycleNote.style.display = "block"; pathCycleNote.textContent = `⚠ ${cycles[0].length} concept(s) forment un cycle de prérequis.`; } 
  else { pathCycleNote.style.display = "none"; }
  pathModalBackdrop.classList.add("open");
});

function closePathModal() { pathModalBackdrop.classList.remove("open"); }
pathModalClose.addEventListener("click", closePathModal);
pathModalBackdrop.addEventListener("click", (e) => { if (e.target === pathModalBackdrop) closePathModal(); });

exportPdfBtn.addEventListener("click", async () => {
  if (!currentCy || !currentGraphData) return;
  exportPdfBtn.disabled = true;
  try { await exportGraphToPdf(currentCy, currentGraphData, { title: graphTitleEl.textContent.trim() || "Graphe" }); showToast("PDF exporté.", "success"); } 
  catch (err) { showToast(`Échec export PDF : ${err.message}`, "error"); } 
  finally { exportPdfBtn.disabled = false; }
});

exportJsonBtn.addEventListener("click", () => {
  if (!currentGraphData) return;
  try { exportGraphToJson(currentGraphData, { title: graphTitleEl.textContent.trim() || "graphe" }); } 
  catch (err) { showToast(`Échec export JSON : ${err.message}`, "error"); }
});

importJsonBtn.addEventListener("click", () => jsonImportInput.click());
jsonImportInput.addEventListener("change", async () => {
  const file = jsonImportInput.files[0]; jsonImportInput.value = "";
  if (!file) return;
  try {
    const text = await file.text(); const parsed = JSON.parse(text);
    if (!Array.isArray(parsed?.nodes) || !Array.isArray(parsed?.edges)) throw new Error("Fichier non valide.");
    currentGraphData = { nodes: parsed.nodes, edges: parsed.edges };
    currentSections = null; currentDbId = null; currentSourceCount = 1; activeChatNode = null;
    graphTitleEl.textContent = file.name.replace(/\.json$/i, "") || "Graphe importé";
    learningPathBtn.disabled = false; exportPdfBtn.disabled = false; exportJsonBtn.disabled = false; statsBtn.disabled = false; arrangeGraphBtn.disabled = false;
    emptyState.style.display = "none"; drawGraph();
    try { await persistGraphToDatabase(); } catch (saveError) { showToast("Graphe importé, mais sauvegarde échouée.", "error"); }
    showToast("Graphe importé.", "success");
  } catch (err) { showToast(`Échec import : ${err.message}`, "error"); }
});

statsBtn.addEventListener("click", () => {
  if (!currentGraphData) return;
  const { nodes, edges } = currentGraphData;
  const avgConfidence = edges.length ? edges.reduce((sum, e) => sum + (e.confidence ?? 0), 0) / edges.length : 0;
  const breakdown = RELATION_TYPES.map((r) => ({ ...r, count: edges.filter((e) => e.type === r.key).length })).filter((r) => r.count > 0);
  statsModalBody.innerHTML = `
    <div class="stats-grid">
      <div class="stat-box"><div class="stat-value">${nodes.length}</div><div class="stat-label">Concepts</div></div>
      <div class="stat-box"><div class="stat-value">${edges.length}</div><div class="stat-label">Relations</div></div>
      <div class="stat-box"><div class="stat-value">${Math.round(avgConfidence * 100)}%</div><div class="stat-label">Confiance moyenne</div></div>
      <div class="stat-box"><div class="stat-value">${currentSourceCount}</div><div class="stat-label">Source(s)</div></div>
    </div>
    ${breakdown.map((r) => `<div class="stats-breakdown-row"><span style="color:${r.color}">${escapeHtml(r.label)}</span><span>${r.count}</span></div>`).join("")}
  `;
  statsModalBackdrop.classList.add("open");
});
statsModalClose.addEventListener("click", () => statsModalBackdrop.classList.remove("open"));
statsModalBackdrop.addEventListener("click", (e) => { if (e.target === statsModalBackdrop) statsModalBackdrop.classList.remove("open"); });

function openAddRelationModal(fromNodeId) {
  if (!currentGraphData?.nodes?.length) return;
  const optionsHtml = currentGraphData.nodes.map((n) => `<option value="${n.id}">${escapeHtml(n.label)}</option>`).join("");
  relationFromSelect.innerHTML = optionsHtml; relationToSelect.innerHTML = optionsHtml;
  relationTypeSelect.innerHTML = RELATION_TYPES.map((r) => `<option value="${r.key}">${escapeHtml(r.label)}</option>`).join("");
  if (fromNodeId) relationFromSelect.value = fromNodeId;
  closeNodePopup(); addRelationModalBackdrop.classList.add("open");
}

addRelationForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!canEdit()) { showToast("Lecture seule.", "error"); return; }
  const source = relationFromSelect.value; const target = relationToSelect.value; const type = relationTypeSelect.value;
  if (source === target) { showToast("Choisis deux concepts différents.", "error"); return; }
  if (!RELATION_KEYS.includes(type)) return;
  currentGraphData.edges.push({ id: `manual_${Date.now().toString(36)}`, source, target, type, confidence: 1, sourceQuote: "Manuel" });
  addRelationModalBackdrop.classList.remove("open"); drawGraph();
  try { await persistGraphToDatabase(); showToast("Relation ajoutée.", "success"); } catch (err) { showToast("Échec sauvegarde.", "error"); }
});
addRelationModalClose.addEventListener("click", () => addRelationModalBackdrop.classList.remove("open"));
addRelationModalBackdrop.addEventListener("click", (e) => { if (e.target === addRelationModalBackdrop) addRelationModalBackdrop.classList.remove("open"); });

initResizeHandle(document.getElementById("resizerLeft"), layoutEl, "--left-panel-width", "left", () => currentCy?.resize());
initResizeHandle(document.getElementById("resizerRight"), layoutEl, "--right-panel-width", "right", () => currentCy?.resize());
window.addEventListener("resize", () => currentCy?.resize());

function escapeHtml(str) { const div = document.createElement("div"); div.textContent = str ?? ""; return div.innerHTML; }

// ============================================================
// Sharing and Access
// ============================================================
openShareModalBtn.addEventListener("click", () => { shareModalBackdrop.classList.add("open"); });
function closeShareModal() {
    shareModalBackdrop.classList.remove("open");
    document.getElementById("shareStatusMsg").style.display = "none";
    document.getElementById("shareEmail").value = "";
}
shareModalClose.addEventListener("click", closeShareModal);
shareModalBackdrop.addEventListener("click", (e) => { if (e.target === shareModalBackdrop) closeShareModal(); });

if (copyLinkBtn) {
    copyLinkBtn.addEventListener("click", async () => {
        if (!currentDbId) return;
        const link = window.location.origin + "/index.html?graphId=" + currentDbId;
        try { await navigator.clipboard.writeText(link); showToast("Lien copié.", "success"); } 
        catch { prompt("Copie ce lien :", link); }
    });
}

async function ensureShareTeam(graphId) {
    const teamId = teamIdFor(graphId);
    try { await teams.create(teamId, "Graphe: " + graphId); } catch (e) { if (e.code !== 409) throw e; }
    await databases.updateDocument(DATABASE_ID, COLLECTION_ID, graphId, undefined, [
        Permission.read(Role.user(currentUser.$id)), Permission.update(Role.user(currentUser.$id)),
        Permission.delete(Role.user(currentUser.$id)), Permission.read(Role.team(teamId))
    ]);
    return teamId;
}

async function narrowUpdatePermissionToEditors(graphId, teamId) {
    try {
        await databases.updateDocument(DATABASE_ID, COLLECTION_ID, graphId, undefined, [
            Permission.read(Role.user(currentUser.$id)), Permission.update(Role.user(currentUser.$id)),
            Permission.delete(Role.user(currentUser.$id)), Permission.read(Role.team(teamId)),
            Permission.update(Role.team(teamId, ["editor"]))
        ]);
    } catch (e) { console.error(e); }
}

confirmShareBtn.addEventListener("click", async () => {
    const email = document.getElementById("shareEmail").value.trim();
    const role = document.getElementById("shareRole").value;
    const currentGraphId = new URLSearchParams(window.location.search).get('graphId');
    if (!email || !currentGraphId) return;

    shareStatusMsg.style.display = "block"; shareStatusMsg.style.color = "var(--text-primary)"; shareStatusMsg.textContent = "Création...";
    confirmShareBtn.disabled = true;
    try {
        const teamId = await ensureShareTeam(currentGraphId);
        const redirectUrl = window.location.origin + '/index.html?graphId=' + currentGraphId;
        await teams.createMembership(teamId, [role], email, undefined, undefined, redirectUrl, undefined);
        if (role === 'editor') await narrowUpdatePermissionToEditors(currentGraphId, teamId);
        shareStatusMsg.style.color = "#8fbf7f"; shareStatusMsg.textContent = `Invitation envoyée.`;
        document.getElementById("shareEmail").value = "";
    } catch (err) {
        shareStatusMsg.style.color = "#e06b6b"; shareStatusMsg.textContent = "Erreur: " + err.message;
    } finally { confirmShareBtn.disabled = false; }
});

openManageModalBtn.addEventListener("click", async () => {
    manageModalBackdrop.classList.add("open");
    await loadCollaborators();
    renderPendingRequests();
});
manageModalClose.addEventListener("click", () => manageModalBackdrop.classList.remove("open"));
manageModalBackdrop.addEventListener("click", (e) => { if (e.target === manageModalBackdrop) manageModalBackdrop.classList.remove("open"); });

async function loadCollaborators() {
    membersList.innerHTML = '<p>Chargement...</p>';
    const currentGraphId = new URLSearchParams(window.location.search).get('graphId');
    const teamId = teamIdFor(currentGraphId);
    try {
        let team = { memberships: [] };
        try { team = await teams.listMemberships(teamId); } catch (e) {}
        const allMembers = team.memberships.filter(m => !m.roles.includes('owner')).map(m => ({ ...m, role: m.roles.find(r => r !== 'owner') || 'viewer', teamId }));
        let html = '';
        if (allMembers.length === 0) { html = '<p>Aucun collaborateur.</p>'; } 
        else {
            allMembers.forEach(member => {
                const status = member.confirm ? '<span style="color:#8fbf7f">(Actif)</span>' : '<span style="color:#e06b6b">(En attente)</span>';
                const userDisplay = member.userEmail || member.userName || "Utilisateur invité";
                const nextRole = member.role === 'viewer' ? 'editor' : 'viewer';
                html += `
                <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-primary); padding:12px; border-radius:12px; border:1px solid var(--border);">
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <span style="font-weight:bold; font-size:14px; color:var(--text-primary);">${userDisplay}</span>
                        <span style="font-size:12px; color:var(--text-muted);">Rôle: <strong style="text-transform:capitalize; color:var(--text-primary);">${member.role}</strong> ${status}</span>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button onclick="changeRole('${teamId}', '${member.$id}', '${nextRole}')" class="secondary-btn" style="padding:6px 12px; font-size:12px; border-radius:8px;">Inverser</button>
                        <button onclick="revokeAccess('${teamId}', '${member.$id}')" class="danger-btn" style="padding:6px 12px; font-size:12px; background:#e06b6b; color:#fff; border:none; border-radius:8px; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>`;
            });
        }
        membersList.innerHTML = html;
    } catch (err) { membersList.innerHTML = '<p style="color:#e06b6b;">Erreur de chargement.</p>'; }
}

window.revokeAccess = async function (teamId, membershipId) {
    if (!confirm("Voulez-vous vraiment retirer l'accès à cet utilisateur ?")) return;
    try { await teams.deleteMembership(teamId, membershipId); showToast("Accès révoqué.", "success"); await loadCollaborators(); } 
    catch (err) { alert("Erreur: " + err.message); }
};

window.changeRole = async function (teamId, membershipId, newRole) {
    if (!confirm(`Voulez-vous changer le rôle de cet utilisateur en "${newRole}" ?`)) return;
    try {
        await teams.updateMembership(teamId, membershipId, [newRole]);
        if (newRole === 'editor') await narrowUpdatePermissionToEditors(teamId.slice(2), teamId);
        showToast("Rôle mis à jour.", "success"); await loadCollaborators();
    } catch (err) { alert("Erreur: " + err.message); }
};

let unsubscribeMembership = null;
let unsubscribeGraphContent = null;

function subscribeToGraphContent(id) {
    if (unsubscribeGraphContent) { unsubscribeGraphContent(); unsubscribeGraphContent = null; }
    unsubscribeGraphContent = client.subscribe(`databases.${DATABASE_ID}.collections.${COLLECTION_ID}.documents.${id}`, (event) => {
        if (!event.events.some(e => e.endsWith('.update'))) return;
        const doc = event.payload;
        try {
            currentGraphData = JSON.parse(doc.graphData);
            currentSections = doc.sections ? JSON.parse(doc.sections) : null;
            if (doc.title) graphTitleEl.textContent = doc.title;
            drawGraph(); showToast("Graphe mis à jour par un collaborateur.", "success");
        } catch (e) {}
    });
}

function subscribeToOwnMembership(graphId) {
    if (unsubscribeMembership) { unsubscribeMembership(); unsubscribeMembership = null; }
    if (isOwner) { applyOwnRole('owner'); return; }
    const teamId = teamIdFor(graphId);
    teams.listMemberships(teamId).then(res => {
        const mine = res.memberships.find(m => m.userId === currentUser.$id);
        if (mine) applyOwnRole(mine.roles.find(r => r !== 'owner') || 'viewer');
    }).catch(() => {});

    unsubscribeMembership = client.subscribe(`teams.${teamId}.memberships`, (event) => {
        const m = event.payload;
        if (m.userId !== currentUser.$id) return;
        if (event.events.some(e => e.endsWith('.delete'))) {
            showToast("Accès révoqué.", "error"); window.location.href = "dashboard.html"; return;
        }
        applyOwnRole(m.roles.find(r => r !== 'owner') || 'viewer');
        showToast(`Ton rôle a changé : ${currentUserRole}.`, "success");
    });
}

function applyOwnRole(role) {
    currentUserRole = role;
    const editAllowed = currentUserRole === 'editor' || isOwner;
    document.body.classList.toggle('read-only-mode', !editAllowed);
    document.querySelectorAll('.editor-only').forEach(el => {
        el.disabled = !editAllowed; el.style.opacity = editAllowed ? '1' : '0.4'; el.style.pointerEvents = editAllowed ? 'auto' : 'none';
    });
}

function canEdit() { return isOwner || currentUserRole === 'editor'; }

if (leaveGraphBtn) {
    leaveGraphBtn.addEventListener("click", async () => {
        if (!confirm("Voulez-vous vraiment quitter ce graphe ?")) return;
        const currentGraphId = new URLSearchParams(window.location.search).get('graphId');
        const teamId = teamIdFor(currentGraphId);
        try {
            const members = await teams.listMemberships(teamId);
            const mine = members.memberships.find(m => m.userId === currentUser.$id);
            if (mine) { await teams.deleteMembership(teamId, mine.$id); alert("Vous avez quitté le graphe."); window.location.href = "dashboard.html"; } 
            else { showToast("Erreur: Accès introuvable.", "error"); }
        } catch (err) { showToast("Erreur lors de la sortie.", "error"); }
    });
}

async function showRequestAccessModal(graphId) {
    if (!requestAccessModalBackdrop) return;
    const titleEl = document.getElementById("requestAccessGraphTitle");
    const statusEl = document.getElementById("requestAccessStatus");
    const btn = document.getElementById("submitAccessRequestBtn");
    statusEl.style.display = "none"; btn.style.display = "inline-block"; btn.disabled = false;

    let meta;
    try { meta = await databases.getDocument(DATABASE_ID, GRAPH_META_COLLECTION_ID, graphId); } 
    catch { titleEl.textContent = "Ce graphe n'existe pas."; btn.style.display = "none"; requestAccessModalBackdrop.classList.add("open"); return; }

    titleEl.textContent = `"${meta.title}"`;
    requestAccessModalBackdrop.classList.add("open");

    let existing = null;
    try {
        const res = await databases.listDocuments(DATABASE_ID, ACCESS_REQUESTS_COLLECTION_ID, [
            Query.equal('graphId', graphId), Query.equal('requesterId', currentUser.$id)
        ]);
        existing = res.documents.find(d => d.status === 'pending') || null;
    } catch (e) {}

    if (existing) {
        statusEl.style.display = "block"; statusEl.style.color = "var(--text-muted)";
        statusEl.textContent = "Demande en attente."; btn.style.display = "none";
        listenToRequestStatus(existing.$id, statusEl); return;
    }

    btn.onclick = async () => {
        btn.disabled = true;
        try {
            const newReq = await databases.createDocument(DATABASE_ID, ACCESS_REQUESTS_COLLECTION_ID, ID.unique(), {
                graphId, ownerId: meta.ownerId, requesterId: currentUser.$id, requesterEmail: currentUser.email, requesterName: currentUser.name || currentUser.email, status: 'pending'
            }, [ Permission.read(Role.users()), Permission.update(Role.users()), Permission.delete(Role.user(currentUser.$id)) ]);
            statusEl.style.display = "block"; statusEl.style.color = "#8fbf7f";
            statusEl.textContent = "Demande envoyée !"; btn.style.display = "none";
            listenToRequestStatus(newReq.$id, statusEl);
        } catch (err) { statusEl.style.display = "block"; statusEl.style.color = "#e06b6b"; statusEl.textContent = "Erreur: " + err.message; btn.disabled = false; }
    };

    function listenToRequestStatus(reqId, statusElement) {
        client.subscribe(`databases.${DATABASE_ID}.collections.${ACCESS_REQUESTS_COLLECTION_ID}.documents.${reqId}`, (response) => {
            if (response.events.some(e => e.endsWith('.update'))) {
                const updatedReq = response.payload;
                if (updatedReq.status === 'accepted') { statusElement.style.color = "#8fbf7f"; statusElement.textContent = "Demande acceptée ! Recharge la page."; } 
                else if (updatedReq.status === 'rejected') { statusElement.style.color = "#e06b6b"; statusElement.textContent = "Demande refusée."; }
            }
        });
    }
}

if (requestAccessModalClose) {
    requestAccessModalClose.addEventListener("click", () => requestAccessModalBackdrop.classList.remove("open"));
}

let pendingRequestsCache = [];
let unsubscribeRequests = null;

async function startPendingRequestsWatch(graphId) {
    if (unsubscribeRequests) { unsubscribeRequests(); unsubscribeRequests = null; }
    const refresh = async () => {
        try {
            const res = await databases.listDocuments(DATABASE_ID, ACCESS_REQUESTS_COLLECTION_ID, [
                Query.equal('graphId', graphId), Query.equal('status', 'pending')
            ]);
            pendingRequestsCache = res.documents; renderPendingRequests();
        } catch (e) {}
    };
    await refresh();
    unsubscribeRequests = client.subscribe(`databases.${DATABASE_ID}.collections.${ACCESS_REQUESTS_COLLECTION_ID}.documents`, (event) => {
        if (event.payload.graphId !== graphId) return; refresh();
    });
}

function renderPendingRequests() {
    const badge = document.getElementById("pendingRequestsBadge");
    if (badge) { badge.textContent = pendingRequestsCache.length; badge.style.display = pendingRequestsCache.length ? 'inline-flex' : 'none'; }
    const listEl = document.getElementById("pendingRequestsList");
    if (!listEl) return;
    if (pendingRequestsCache.length === 0) { listEl.innerHTML = ''; return; }
    listEl.innerHTML = `<p style="font-size:11px; color:var(--text-muted); text-transform:uppercase;">Demandes en attente</p>` +
        pendingRequestsCache.map(req => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-primary); padding:12px; border-radius:12px; border:1px solid var(--accent-cyan); margin-bottom:10px;">
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <span style="font-weight:bold; font-size:14px;">${escapeHtml(req.requesterName || req.requesterEmail)}</span>
                    <span style="font-size:12px; color:var(--text-muted);">${escapeHtml(req.requesterEmail)}</span>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <select id="role-${req.$id}" style="border-radius:8px; padding:4px 6px; background:var(--bg-panel); color:var(--text-primary); border:1px solid var(--border);">
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                    </select>
                    <button onclick="acceptAccessRequest('${req.$id}')" class="secondary-btn" style="padding:6px 10px; color:#8fbf7f;">Accepter</button>
                    <button onclick="rejectAccessRequest('${req.$id}')" class="danger-btn" style="padding:6px 10px; background:#e06b6b; color:#fff;">Refuser</button>
                </div>
            </div>`).join('');
}

window.acceptAccessRequest = async function (requestId) {
    const req = pendingRequestsCache.find(r => r.$id === requestId);
    if (!req) return;
    const role = document.getElementById(`role-${requestId}`)?.value || 'viewer';
    try {
        const teamId = await ensureShareTeam(req.graphId);
        const redirectUrl = window.location.origin + '/index.html?graphId=' + req.graphId;
        await teams.createMembership(teamId, [role], req.requesterEmail, undefined, undefined, redirectUrl, undefined);
        if (role === 'editor') await narrowUpdatePermissionToEditors(req.graphId, teamId);
        await databases.updateDocument(DATABASE_ID, ACCESS_REQUESTS_COLLECTION_ID, requestId, { status: 'accepted' });
        showToast(`Accès accordé à ${req.requesterEmail}.`, "success"); await loadCollaborators();
    } catch (err) { alert("Erreur: " + err.message); }
};

window.rejectAccessRequest = async function (requestId) {
    try { await databases.updateDocument(DATABASE_ID, ACCESS_REQUESTS_COLLECTION_ID, requestId, { status: 'rejected' }); showToast("Demande refusée.", "success"); } 
    catch (err) { alert("Erreur: " + err.message); }
};
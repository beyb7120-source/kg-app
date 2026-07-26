import { showToast, initThemeToggle } from "./ui.js";

const { Client, Account, Databases, Query, ID } = window.Appwrite;

const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6a667fe600130a273954');

const account = new Account(client);
const databases = new Databases(client);

// بدّل هادو بالآيديات الصحاح ديالك
const DATABASE_ID = '6a6682d6000846a6685e';
const COLLECTION_ID = 'kg-app';

const PAGE_SIZE = 12;
// Emojis مقترحين للكارد — بلا اعتماد على input نص حر (أبسط وأسرع UX).
const ICON_CHOICES = ["📄", "📘", "📙", "📗", "🧠", "⚔️", "🧬", "🔬", "🌍", "📐", "⚙️", "💡"];

// التحقق واش المستخدم يالاه جا من دعوة ديال شي مبيان
const pendingInvite = localStorage.getItem('pendingInviteUrl');
if (pendingInvite) {
    localStorage.removeItem('pendingInviteUrl'); // نمسحوها باش ماتبقاش لاصقة
    window.location.href = pendingInvite; // نرجعوه نيشان يقبل الدعوة ويشوف المبيان
}
const userNameEl = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const graphsGrid = document.getElementById('graphsGrid');
const createNewGraphBtn = document.getElementById('createNewGraphBtn');
const searchInput = document.getElementById('searchInput');
const loadMoreWrap = document.getElementById('loadMoreWrap');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');

let currentUser = null;
// كنخزنو DIRECTEMENT كل الوثائق اللي تحملو (على قدر ما دار المستخدم "Charger
// plus") — البحث كيفلتر فهاد اللائحة محليًا (ماشي query جديدة فـ Appwrite,
// حيت مافيهاش fulltext index على "title"). حدود هاد الطريقة: البحث كيخدم
// غير على الغرافات اللي تحملو ديجا — مذكورة فـ README.
let allGraphs = [];
let hasMore = true;

initThemeToggle(themeToggleBtn);

createNewGraphBtn.addEventListener('click', () => {
    window.location.href = 'index.html';
});

async function initDashboard() {
    try {
        currentUser = await account.get();
        userNameEl.textContent = currentUser.name || currentUser.email;
        await loadUserGraphs({ reset: true });
    } catch (error) {
        window.location.href = 'auth/login.html';
    }
}

/**
 * @param {{reset?: boolean}} [opts] — reset=true : première page (efface allGraphs).
 */
async function loadUserGraphs({ reset = false } = {}) {
    try {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = "Chargement...";

        const response = await databases.listDocuments(
            DATABASE_ID,
            COLLECTION_ID,
            [
                /* Query.equal('userId', currentUser.$id), */
                Query.orderDesc('$createdAt'),
                Query.limit(PAGE_SIZE),
                Query.offset(reset ? 0 : allGraphs.length),
            ]
        );

        allGraphs = reset ? response.documents : [...allGraphs, ...response.documents];
        hasMore = allGraphs.length < response.total;

        renderGraphs(filterGraphs(allGraphs, searchInput.value));
        updateLoadMoreVisibility();
    } catch (error) {
        console.error("Erreur lors du chargement des graphes:", error);
        showToast("Impossible de charger tes graphes. Réessaie dans un instant.", "error");
    } finally {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = "Charger plus";
    }
}

function updateLoadMoreVisibility() {
    // كنخبيو "Charger plus" فاش كاين بحث نشط (البحث كيخدم غير على المحمل،
    // تحميل صفحة جديدة ماغاديش يزيد نتائج البحث بطريقة بديهية للمستخدم).
    loadMoreWrap.style.display = hasMore && !searchInput.value.trim() ? "flex" : "none";
}

function filterGraphs(graphs, query) {
    const q = query.trim().toLowerCase();
    if (!q) return graphs;
    return graphs.filter((g) => (g.title || "").toLowerCase().includes(q));
}

searchInput.addEventListener('input', () => {
    renderGraphs(filterGraphs(allGraphs, searchInput.value));
    updateLoadMoreVisibility();
});

loadMoreBtn.addEventListener('click', () => loadUserGraphs({ reset: false }));

function renderGraphs(graphs) {
    const existingCards = graphsGrid.querySelectorAll('.graph-card:not(.create-card)');
    existingCards.forEach(card => card.remove());

    if (!graphs.length) {
        const hint = document.createElement('p');
        hint.className = 'dashboard-empty-hint';
        hint.textContent = allGraphs.length
            ? "Aucun graphe ne correspond à ta recherche."
            : "Tu n'as pas encore de graphe — clique sur « Create new graph » pour commencer.";
        graphsGrid.appendChild(hint);
        return;
    }

    graphs.forEach((graph) => {
        const card = document.createElement('div');
        card.className = `graph-card ${graph.pinned ? 'is-pinned' : ''}`;

        const date = new Date(graph.$createdAt).toLocaleDateString('fr-FR', {
            day: 'numeric', month: 'short', year: 'numeric'
        });

        const isOwner = graph.userId === currentUser.$id;
        const sharedBadge = !isOwner ? '<span style="background:var(--accent); color:#fff; font-size:10px; padding:2px 8px; border-radius:12px; margin-left:8px; vertical-align:middle;">Partagé avec moi</span>' : '';

        card.innerHTML = `
            <div class="card-header">
                <div class="card-icon-wrap" style="position:relative">
                    <button type="button" class="card-icon-btn" title="Changer l'icône" aria-label="Changer l'icône du graphe">${graph.icon || '📄'}</button>
                    <div class="icon-picker" role="menu">
                        ${ICON_CHOICES.map((ic) => `<button type="button" data-icon="${ic}">${ic}</button>`).join('')}
                    </div>
                </div>
                <div class="card-menu-container">
                    <button class="card-options" aria-label="Options du graphe"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                    <div class="card-dropdown">
                        <button class="card-menu-item pin-btn">
                            <i class="fa-solid fa-thumbtack"></i> ${graph.pinned ? 'Détacher' : 'Épingler'}
                        </button>
                        <button class="card-menu-item rename-btn">
                            <i class="fa-solid fa-pen"></i> Renommer
                        </button>
                        <button class="card-menu-item duplicate-btn">
                            <i class="fa-solid fa-copy"></i> Dupliquer
                        </button>
                        <button class="card-menu-item delete-item delete-btn">
                            <i class="fa-solid fa-trash"></i> Supprimer
                        </button>
                    </div>
                </div>
            </div>
            <div class="card-info">
            <h3>${escapeHtml(graph.title)}</h3>  
                
                <p>${date} • ${graph.sourceCount || 0} source(s)</p>
            </div>
        `;

        const optionsBtn = card.querySelector('.card-options');
        const dropdown = card.querySelector('.card-dropdown');
        const iconBtn = card.querySelector('.card-icon-btn');
        const iconPicker = card.querySelector('.icon-picker');

        optionsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.card-dropdown').forEach(d => {
                if (d !== dropdown) d.classList.remove('show');
            });
            dropdown.classList.toggle('show');
        });

        // Icon picker
        iconBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.icon-picker').forEach(p => {
                if (p !== iconPicker) p.classList.remove('show');
            });
            iconPicker.classList.toggle('show');
        });
        iconPicker.querySelectorAll('button[data-icon]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                iconPicker.classList.remove('show');
                const newIcon = btn.dataset.icon;
                try {
                    await databases.updateDocument(DATABASE_ID, COLLECTION_ID, graph.$id, { icon: newIcon });
                    graph.icon = newIcon;
                    iconBtn.textContent = newIcon;
                } catch (err) {
                    console.error("Erreur changement d'icône:", err);
                    showToast("Impossible de changer l'icône.", "error");
                }
            });
        });

        // زر Pin
        card.querySelector('.pin-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            dropdown.classList.remove('show');
            try {
                const newPinnedState = !graph.pinned;
                await databases.updateDocument(DATABASE_ID, COLLECTION_ID, graph.$id, {
                    pinned: newPinnedState
                });
                graph.pinned = newPinnedState;
                renderGraphs(filterGraphs(allGraphs, searchInput.value));
            } catch (err) {
                console.error("Erreur Pin:", err);
                showToast("Impossible d'épingler ce graphe.", "error");
            }
        });

        // زر Rename
        card.querySelector('.rename-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            dropdown.classList.remove('show');
            const newTitle = prompt("Entrez le nouveau nom du graphe :", graph.title);
            if (newTitle && newTitle.trim() !== "") {
                try {
                    await databases.updateDocument(DATABASE_ID, COLLECTION_ID, graph.$id, {
                        title: newTitle.trim()
                    });
                    graph.title = newTitle.trim();
                    renderGraphs(filterGraphs(allGraphs, searchInput.value));
                } catch (err) {
                    console.error("Erreur Rename:", err);
                    showToast("Impossible de renommer ce graphe.", "error");
                }
            }
        });

        // زر Duplicate
        card.querySelector('.duplicate-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            dropdown.classList.remove('show');
            try {
                const copy = await databases.createDocument(DATABASE_ID, COLLECTION_ID, ID.unique(), {
                    userId: currentUser.$id,
                    title: `${graph.title} (copie)`,
                    icon: graph.icon || '📄',
                    sourceCount: graph.sourceCount || 0,
                    graphData: graph.graphData,
                    sections: graph.sections ?? null,
                    pinned: false,
                });
                allGraphs = [copy, ...allGraphs];
                renderGraphs(filterGraphs(allGraphs, searchInput.value));
                showToast("Graphe dupliqué.", "success");
            } catch (err) {
                console.error("Erreur Duplication:", err);
                showToast("Impossible de dupliquer ce graphe.", "error");
            }
        });

        // زر Delete
        card.querySelector('.delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            dropdown.classList.remove('show');
            if (confirm(`Voulez-vous vraiment supprimer "${graph.title}" ?`)) {
                try {
                    await databases.deleteDocument(DATABASE_ID, COLLECTION_ID, graph.$id);
                    allGraphs = allGraphs.filter((g) => g.$id !== graph.$id);
                    renderGraphs(filterGraphs(allGraphs, searchInput.value));
                } catch (err) {
                    console.error("Erreur Delete:", err);
                    showToast("Impossible de supprimer ce graphe.", "error");
                }
            }
        });

        card.addEventListener('click', () => {
            window.location.href = `index.html?graphId=${graph.$id}`;
        });

        graphsGrid.appendChild(card);
    });
}

// إغلاق القوائم المنسدلة والـ icon pickers إيلا كليكا المستخدم فأي بلاصة خاوية
window.addEventListener('click', () => {
    document.querySelectorAll('.card-dropdown').forEach(d => d.classList.remove('show'));
    document.querySelectorAll('.icon-picker').forEach(p => p.classList.remove('show'));
});

logoutBtn.addEventListener('click', async () => {
    await account.deleteSession('current');
    window.location.href = 'auth/login.html';
});

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? "";
    return div.innerHTML;
}

initDashboard();

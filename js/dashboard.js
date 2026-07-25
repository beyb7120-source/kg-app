const { Client, Account, Databases, Query } = window.Appwrite;

const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6a6406f5003a13231358'); 

const account = new Account(client);
const databases = new Databases(client);

// بدّل هادو بالآيديات الصحاح ديالك
const DATABASE_ID = '6a64b2d8001b82e7f4dd'; 
const COLLECTION_ID = 'userid'

const userNameEl = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const graphsGrid = document.getElementById('graphsGrid');
const createNewGraphBtn = document.getElementById('createNewGraphBtn');


let currentUser = null;

// 1. هادي غتخلي البوطونة خدامة 100% ديما، واخا الداتابيز تتعطل
createNewGraphBtn.addEventListener('click', () => {
    window.location.href = 'index.html'; 
});

async function initDashboard() {
    try {
        currentUser = await account.get();
        userNameEl.textContent = currentUser.name || currentUser.email;
        loadUserGraphs();
    } catch (error) {
        window.location.href = 'auth/login.html';
    }
}

async function loadUserGraphs() {
    try {
        const response = await databases.listDocuments(
            DATABASE_ID,
            COLLECTION_ID,
            [
                Query.equal('userId', currentUser.$id),
                Query.orderDesc('$createdAt')
            ]
        );
        renderGraphs(response.documents);
    } catch (error) {
        console.error("Erreur lors du chargement des graphes:", error);
        // واخا يوقع إيرور، البوطونة غتبقى خدامة حيت عزلناها الفوق
    }
}

function renderGraphs(graphs) {
    const existingCards = graphsGrid.querySelectorAll('.graph-card:not(.create-card)');
    existingCards.forEach(card => card.remove());

    graphs.forEach((graph) => {
        const card = document.createElement('div');
        // هنا حيدنا السطر ديال card.style.backgroundColor فمرة
        card.className = `graph-card ${graph.pinned ? 'is-pinned' : ''}`;
        
        const date = new Date(graph.$createdAt).toLocaleDateString('fr-FR', {
            day: 'numeric', month: 'short', year: 'numeric'
        });

        card.innerHTML = `
            <div class="card-header">
                <span class="card-icon">${graph.icon || '📄'}</span>
                <div class="card-menu-container">
                    <button class="card-options"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                    <div class="card-dropdown">
                        <button class="card-menu-item pin-btn">
                            <i class="fa-solid fa-thumbtack"></i> ${graph.pinned ? 'Détacher' : 'Épingler'}
                        </button>
                        <button class="card-menu-item rename-btn">
                            <i class="fa-solid fa-pen"></i> Renommer
                        </button>
                        <button class="card-menu-item delete-item delete-btn">
                            <i class="fa-solid fa-trash"></i> Supprimer
                        </button>
                    </div>
                </div>
            </div>
            <div class="card-info">
                <h3>${graph.title}</h3>
                <p>${date} • ${graph.sourceCount || 0} source(s)</p>
            </div>
        `;

        const optionsBtn = card.querySelector('.card-options');
        const dropdown = card.querySelector('.card-dropdown');

        optionsBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            document.querySelectorAll('.card-dropdown').forEach(d => {
                if (d !== dropdown) d.classList.remove('show');
            });
            dropdown.classList.toggle('show');
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
                loadUserGraphs(); 
            } catch (err) {
                console.error("Erreur Pin:", err);
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
                    loadUserGraphs();
                } catch (err) {
                    console.error("Erreur Rename:", err);
                }
            }
        });

        // زر Delete
        card.querySelector('.delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            dropdown.classList.remove('show');
            if (confirm(`Voulez-vous vraiment supprimer "${graph.title}" ?`)) {
                try {
                    await databases.deleteDocument(DATABASE_ID, COLLECTION_ID, graph.$id);
                    card.remove(); 
                } catch (err) {
                    console.error("Erreur Delete:", err);
                }
            }
        });

        card.addEventListener('click', () => {
            window.location.href = `index.html?graphId=${graph.$id}`;
        });

        graphsGrid.appendChild(card);
    });
}

// إغلاق القوائم المنسدلة إيلا كليكا المستخدم في أي بلاصة خاوية فالبصة
window.addEventListener('click', () => {
    document.querySelectorAll('.card-dropdown').forEach(d => d.classList.remove('show'));
});

logoutBtn.addEventListener('click', async () => {
    await account.deleteSession('current');
    window.location.href = 'auth/login.html';
});

initDashboard();
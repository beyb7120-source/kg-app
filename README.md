# Graphe de concepts — MVP

Prototype pour transformer un cours (PDF numérique ou texte collé) en graphe de concepts
avec relations typées (implication, prérequis, exemple, etc.), extrait par Gemini.

## Lancer le projet

Le code utilise des modules ES (`import`/`export`), donc **il ne faut PAS ouvrir
`index.html` directement en double-clic** (`file://`) — les navigateurs bloquent les
imports de modules sur ce protocole. Lance un petit serveur local à la place :

```bash
cd kg-app
python3 -m http.server 8000
# puis ouvre http://localhost:8000 dans ton navigateur
```

(ou `npx serve .` si tu préfères Node.)

## Ta clé API

- Colle-la dans le champ en haut à droite **à chaque session**. Elle vit uniquement en
  mémoire JS (`runtimeAuth.apiKey` dans `config.js`) et n'est jamais écrite sur disque,
  dans `localStorage`, ni dans un fichier de config.
- **Ne la colle jamais en dur dans le code source**, surtout si tu comptes un jour
  partager ce dossier (GitHub, hébergement, etc.) — n'importe qui lisant le code
  pourrait l'utiliser sur ton compte et générer de la facturation dès que le free tier
  est dépassé.
- Récupère une clé gratuite sur https://console.mistral.ai (tier "Experiment").

## Modèle utilisé

- `mistral-large-latest` pour les deux étapes (lecture ET extraction du graphe). Le free
  tier ne propose pas de modèle "petit/rapide" séparé à des limites plus larges, donc
  contrairement à la version Gemini, les deux étapes partagent le même modèle — mais
  chacune garde ses propres instructions strictes et son propre rôle (voir `stages/*.js`).

### Ce qui change par rapport à Gemini (important)

- **Pas de schema JSON imposé par l'API.** Gemini forçait la structure exacte de la
  réponse (`responseSchema`). Mistral n'offre que `response_format: {"type":
  "json_object"}`, qui garantit un JSON valide mais pas une structure précise. La
  structure attendue est donc enseignée par un **exemple littéral** dans le prompt
  (`SCHEMA_EXAMPLE` dans chaque étage), et vérifiée après coup par `validateSections()` /
  `validateGraph()` qui rejette silencieusement tout ce qui ne colle pas à la forme
  attendue plutôt que de planter.
- **2 requêtes/minute sur le free tier.** `mistralClient.js` espace automatiquement les
  appels d'~31s et retente une fois après 65s en cas de 429. Concrètement : lancer le
  pipeline prend maintenant ~35-45s de plus qu'avec Gemini à cause de cette pause
  volontaire — c'est normal, pas un bug.
- **Endpoint et format différents** : `POST https://api.mistral.ai/v1/chat/completions`
  avec `Authorization: Bearer <clé>`, format `messages` façon OpenAI, au lieu du format
  `contents`/`systemInstruction` de Gemini.

Pour changer à nouveau de fournisseur plus tard, seul `js/mistralClient.js` (le point
d'entrée réseau unique) et le champ `MODELS` dans `config.js` ont besoin d'être touchés —
c'est exactement ce que cette architecture modulaire est censée rendre facile.

## Portée actuelle (MVP) — ce qui n'est PAS géré

- **PDF scannés / photographiés** : l'app détecte ce cas et affiche une erreur claire
  plutôt que d'envoyer du texte vide au modèle. Pour gérer ce cas, il faudrait ajouter
  une étape qui envoie l'image de chaque page à un modèle vision (`gemini-2.5-flash`
  supporte les images) au lieu du texte extrait par `pdf.js`.
- **Écriture manuscrite** : pareil, hors scope volontairement pour ce MVP (voir la
  discussion sur la fiabilité variable de l'OCR manuscrit).
- **Schémas/diagrammes dans les slides** : les relations dessinées visuellement (flèches
  sur une image) ne sont pas captées, seul le texte l'est.

## Architecture (pourquoi c'est découpé comme ça)

```
pdfReader.js  ─┐
               ├─▶ pipeline.js ─▶ extractionStage.run() ─▶ graphStage.run() ─▶ graphRenderer.render()
pasteText     ─┘        (orchestrateur, ordre des étapes seulement)
```

Chaque étage (`stages/*.js`) suit le même moule :
`async function run(input, context) -> output`. `pipeline.js` ne connaît que cette
signature — il ne sait rien du contenu de chaque étage. Pour ajouter un étage (ex: une
étape de résolution des doublons de concepts entre sections), il suffit d'écrire un
nouveau fichier avec un `run()` de la même forme et de l'ajouter au tableau `STAGES`
dans `pipeline.js`.

## Réglages de fiabilité déjà en place

- Vocabulaire de relations **fermé** (enum imposé au niveau du schema JSON, pas
  seulement dans le prompt) — voir `RELATION_TYPES` dans `config.js`.
- **Grounding obligatoire** : chaque nœud/relation doit citer un passage source.
- Le modèle a instruction de **rejeter** les relations ambiguës/bidirectionnelles plutôt
  que de deviner.
- `temperature: 0.1` sur les deux appels — pas de créativité voulue ici.
- Slider de confiance minimale dans l'UI pour filtrer les relations à faible score sans
  refaire un appel API.

## Nouveautés (session 2)

Ajouté sans toucher au rôle des fichiers existants — chaque nouveau fichier garde UN
job, comme les stages :

- **`js/graphQueries.js`** (pur) — `getNodeRelations(nodeId, graphData)` regroupe toutes
  les relations d'un concept (sortantes/entrantes, groupées par type, voisin déjà
  résolu). C'est ce qui alimente le panneau de détails enrichi : cliquer un nœud montre
  maintenant "ce qu'il implique" et "ce qui mène à lui", pas juste sa définition. Les
  concepts voisins sont cliquables (chips) et redirigent le détail vers eux.
- **`js/sourceView.js`** (pur) — `findSection`, `findSectionByQuote`, `highlightQuote`.
  Le clic sur "Voir dans le texte source →" (nœud ou relation) ouvre un panneau latéral
  qui affiche la section d'origine avec le passage cité surligné (`<mark>`) et scrollé en
  vue. Les relations n'ayant pas de `sourceSectionId` dans le schema actuel, la recherche
  retombe sur un scan de toutes les sections par contenu de citation.
- **`js/learningPath.js`** (pur, **aucun appel API**) — `computeLearningPath(graphData)`
  fait un tri topologique (Kahn) sur les relations `prerequisite_of` pour proposer un
  ordre de révision. Volontairement PAS un 3ᵉ appel Mistral : l'ordre découle des
  relations déjà extraites (et déjà groundées), ce qui évite un nouveau risque
  d'hallucination et ~30s d'attente supplémentaire. Les cycles de prérequis (rares mais
  possibles) sont détectés et signalés plutôt que de planter.
- **`js/chatClient.js`** (réseau, via `mistralClient.js`) — `askAboutConcept(...)` pour
  le bouton "💬 Demander à l'IA" du panneau de détails. Le contexte envoyé au modèle
  inclut la définition, la citation source ET le texte complet de la section d'origine,
  avec instruction explicite de prioriser ce contenu et de signaler clairement tout
  ajout hors-cours.
- **`js/graphExporter.js`** — `exportGraphToPdf(cy, graphData, meta)` capture le graphe
  Cytoscape rendu (`cy.png()`) et génère un PDF téléchargeable via jsPDF. Aucun appel
  réseau à Mistral : c'est un export d'image côté client.
- **`js/resizablePanels.js`** — `initResizeHandle(...)`, générique et sans aucune
  connaissance du domaine (graphe/pipeline) : ajoute les deux séparateurs
  redimensionnables entre panneau gauche / graphe / panneau droit.

### Changement de forme dans `pipeline.js`

`execute()` retournait avant seulement la sortie du DERNIER stage. Il retourne
maintenant un objet `{ extraction: sections[], graph: {nodes, edges} }` — la sortie de
CHAQUE stage, indexée par son nom. Chaque stage continue de ne voir QUE la sortie du
stage précédent (le moule `run(input, context) -> output` n'a pas changé) ; seul
`pipeline.js` accumule pour que `app.js` puisse réutiliser les sections de l'étape 1
(source view, contexte du chat) en plus du graphe final de l'étape 2. Si un stage est
ajouté après `"graph"`, sa sortie apparaît simplement comme une nouvelle clé, sans rien
changer d'autre dans ce fichier.

`graphRenderer.render()` retourne maintenant l'instance Cytoscape (au lieu de la garder
privée dans le module) pour que `app.js` puisse la réutiliser : export PDF, sélection
programmatique d'un nœud depuis le parcours d'apprentissage, `cy.resize()` pendant le
glissement des séparateurs.

## Pas encore fait (prochaines étapes suggérées)

- Golden dataset manuel (10-15 concepts) pour mesurer précision/rappel avant de changer
  le prompt — actuellement il n'y a aucune métrique de qualité automatisée.
- Étage "critique" (2e passe qui relit le graphe et signale doublons/incohérences).
- Fusion d'entités entre sections (ex: "débit" et "débit volumique" mentionnés
  séparément dans deux sections différentes).

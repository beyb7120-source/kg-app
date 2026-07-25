// ============================================================
// config.js — single source of truth for the whole pipeline.
// Every other module reads from here instead of hardcoding
// model names / relation types in multiple places.
// ============================================================

// Runtime-only key holder. Never persisted to disk or localStorage.
// The user pastes their key in the UI each session (see app.js).
export const runtimeAuth = {
  apiKey: null,
};

export const MODELS = {
  // Free tier ("Experiment") on La Plateforme gives access to the same
  // Mistral Large model for both stages — no cheap/expensive split like
  // the Gemini setup had, since the free tier doesn't offer a smaller
  // model at meaningfully looser rate limits. Both stages share one
  // model, but each still gets its OWN strict system instruction
  // (see stages/*.js) — the model doesn't change, the job still does.
  extraction: "mistral-large-latest",
  reasoning: "mistral-large-latest",
  // Used by chatClient.js ("Demander à l'IA" button in the detail panel).
  // Same model as the two pipeline stages for the same free-tier reason —
  // kept as its own key so it can be swapped independently later.
  chat: "mistral-large-latest",
};

// Closed vocabulary for edge types. Adding a type here automatically:
//  - gets listed in stage 2's prompt AND checked by validateGraph()
//    on the way back (Mistral's JSON mode has no enum enforcement,
//    so this vocabulary is taught by prompt + enforced by our own code)
//  - shows up in the legend
//  - gets a distinct line style in the renderer
export const RELATION_TYPES = [
  {
    key: "implies",
    label: "implique / mène à",
    color: "#E8934A",
    lineStyle: "solid",
    arrow: "triangle",
  },
  {
    key: "prerequisite_of",
    label: "prérequis de",
    color: "#6FC3DF",
    lineStyle: "solid",
    arrow: "triangle-backcurve",
  },
  {
    key: "part_of",
    label: "fait partie de",
    color: "#93A9C2",
    lineStyle: "dashed",
    arrow: "triangle",
  },
  {
    key: "example_of",
    label: "exemple de",
    color: "#8FBF7F",
    lineStyle: "dotted",
    arrow: "circle",
  },
  {
    key: "defined_by",
    label: "défini par",
    color: "#C99BE0",
    lineStyle: "solid",
    arrow: "diamond",
  },
  {
    key: "contrasts_with",
    label: "contraste avec",
    color: "#E06B6B",
    lineStyle: "dashed",
    arrow: "none",
  },
];

export const RELATION_KEYS = RELATION_TYPES.map((r) => r.key);

// Minimum confidence an edge needs to be shown by default.
// The UI slider (app.js) can change this at render time without
// re-running the pipeline.
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

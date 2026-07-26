// ============================================================
// ui.js — petits utilitaires d'UI partagés entre index.html et
// dashboard.html : toasts (feedback visible) + theme toggle
// (dark/light). Ne touche ni au réseau ni au domaine métier —
// juste du DOM générique, réutilisable partout.
// ============================================================

const TOAST_DURATION_MS = 4500;
const THEME_STORAGE_KEY = "constella-theme"; // "dark" (défaut) ou "light"

/**
 * Affiche un toast dans #toastContainer (doit exister dans la page).
 * @param {string} message
 * @param {"error"|"success"|"info"} [type]
 */
export function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) {
    // Fallback défensif si la page n'a pas le container (ne devrait pas arriver).
    console.warn("[toast]", type, message);
    return;
  }

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.transition = "opacity 0.25s ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 250);
  }, TOAST_DURATION_MS);
}

/**
 * Câble un bouton pour basculer entre thème sombre (défaut) et clair.
 * Le choix est mémorisé (localStorage) — c'est une préférence d'affichage
 * non sensible, donc localStorage convient ici (contrairement aux
 * artifacts Claude où c'est interdit : ceci est l'app réelle déployée).
 * @param {HTMLElement} buttonEl
 */
export function initThemeToggle(buttonEl) {
  if (!buttonEl) return;

  const icon = buttonEl.querySelector("i");

  function apply(theme) {
    document.body.classList.toggle("theme-light", theme === "light");
    if (icon) {
      icon.className = theme === "light" ? "fa-solid fa-moon" : "fa-solid fa-sun";
    }
    buttonEl.title = theme === "light" ? "Passer en thème sombre" : "Passer en thème clair";
  }

  const saved = localStorage.getItem(THEME_STORAGE_KEY) || "dark";
  apply(saved);

  buttonEl.addEventListener("click", () => {
    const next = document.body.classList.contains("theme-light") ? "dark" : "light";
    localStorage.setItem(THEME_STORAGE_KEY, next);
    apply(next);
  });
}

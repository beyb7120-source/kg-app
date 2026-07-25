// ============================================================
// resizablePanels.js — generic drag-to-resize handles for a CSS
// grid layout. Knows nothing about the graph/pipeline domain — it
// only reads/writes a CSS custom property on a grid container, so
// it can't leak any app-specific assumptions and could be reused
// on any other panel layout as-is.
// ============================================================

const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 520;

/**
 * Wires a drag handle that resizes one grid-template-columns track
 * by writing to a CSS custom property (e.g. "--left-panel-width").
 *
 * @param {HTMLElement} handle    — the thin draggable bar between two panels
 * @param {HTMLElement} gridEl    — element whose CSS var controls the column width
 * @param {string} cssVarName     — e.g. "--left-panel-width"
 * @param {"left"|"right"} side   — which side of the handle the resized panel sits on
 * @param {Function} [onResize]   — called after each width change (e.g. cy.resize())
 */
export function initResizeHandle(resizerEl, containerEl, cssVarName, side, onResize) {
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  // ملي المستخدم كيكليكي على الـ Divider باش يبدا يجرّ
  resizerEl.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    // كنجبدو العرض الحالي ديال الـ Panel من الـ CSS Variables
    startWidth = parseInt(getComputedStyle(containerEl).getPropertyValue(cssVarName)) || 300;

    // كنزيدو هاد الـ Class للـ body باش نمنعو التحديد (Text Selection) اثناء السحب
    document.body.classList.add('resizing');
  });

  // ملي المستخدم كيحرك الماوس وهو مزال مكليكي
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    let deltaX = e.clientX - startX;
    
    // الا كنا كنجرو الجيهة اليسرية، كنزيدو العرض، الا كانت اليمينية كنقصوه (حيت العكس ديال الاتجاه)
    let newWidth = side === 'left' ? startWidth + deltaX : startWidth - deltaX;

    // درنا حدود باش الـ Panel مايصغارش بزاف (< 250px) ومايكبرش بزاف (> 600px)
    if (newWidth < 250) newWidth = 250;
    if (newWidth > 600) newWidth = 600;

    // كنحدثو المتغير فـ CSS لي كيتحكم فالعرض ديال الكولون
    containerEl.style.setProperty(cssVarName, `${newWidth}px`);

    // الا كاين شي دالة كدار ملي كيتغير الحجم (بحال التحديث ديال Cytoscape)، كنعيطو عليها
    if (onResize) onResize();
  });

  // ملي المستخدم كيطلق الكليك ديال الماوس
  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.classList.remove('resizing');
    }
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const INSPECTOR_CARD_SELECTOR = [
  "#desktop-status-panel .desktop-status-item",
  "#run-timeline .run-timeline-entry",
  "#runtime-trace-list .runtime-trace-item",
  "#evidence-preview .evidence-preview-item",
].join(", ");

const clampPercent = (value) => Math.max(0, Math.min(100, value));

/**
 * Attach the ReactBits SpotlightCard interaction to current and future
 * inspector cards without coupling the desktop page to a React runtime.
 */
export function initInspectorSpotlight(root, { finePointer = true, reducedMotion = false } = {}) {
  if (!root || !finePointer || reducedMotion || typeof root.addEventListener !== "function") {
    return () => {};
  }

  let activeCard = null;

  const clearActiveCard = () => {
    if (!activeCard) return;
    delete activeCard.dataset.spotlightActive;
    activeCard = null;
  };

  const closestInspectorCard = (target) => {
    if (typeof target?.closest !== "function") return null;
    const card = target.closest(INSPECTOR_CARD_SELECTOR);
    return card && root.contains(card) ? card : null;
  };

  const onPointerMove = (event) => {
    if (event.pointerType === "touch") {
      clearActiveCard();
      return;
    }

    const card = closestInspectorCard(event.target);
    if (!card) {
      clearActiveCard();
      return;
    }

    const bounds = card.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      clearActiveCard();
      return;
    }

    if (activeCard !== card) {
      clearActiveCard();
      activeCard = card;
    }

    const x = Math.round(clampPercent(((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.round(clampPercent(((event.clientY - bounds.top) / bounds.height) * 100));
    card.style.setProperty("--spotlight-x", `${x}%`);
    card.style.setProperty("--spotlight-y", `${y}%`);
    card.dataset.spotlightActive = "true";
  };

  const onPointerOut = (event) => {
    if (!activeCard) return;
    if (closestInspectorCard(event.relatedTarget) !== activeCard) clearActiveCard();
  };

  root.addEventListener("pointermove", onPointerMove, { passive: true });
  root.addEventListener("pointerout", onPointerOut, { passive: true });
  root.addEventListener("pointerleave", clearActiveCard, { passive: true });

  return () => {
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerout", onPointerOut);
    root.removeEventListener("pointerleave", clearActiveCard);
    clearActiveCard();
  };
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  const finePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const inspector = document.getElementById("runtime-inspector");
  initInspectorSpotlight(inspector, { finePointer, reducedMotion });
}

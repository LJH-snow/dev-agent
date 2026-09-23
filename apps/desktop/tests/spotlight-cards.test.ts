import assert from "node:assert/strict";
import test from "node:test";

const { initInspectorSpotlight } = await import(
  new URL("../public/spotlight-cards.js", import.meta.url).href
);

class FakeRoot {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  contains(node) {
    return node?.inside !== false;
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function makeCard({ left = 100, top = 200, width = 200, height = 100 } = {}) {
  const values = new Map();
  return {
    inside: true,
    dataset: {} as { spotlightActive?: string },
    style: { setProperty: (name, value) => values.set(name, value), values },
    getBoundingClientRect: () => ({ left, top, width, height }),
    closest: () => null,
  };
}

function targetFor(card) {
  return { closest: () => card };
}

test("inspector spotlight follows pointer coordinates on dynamically rendered cards", () => {
  const root = new FakeRoot();
  const stop = initInspectorSpotlight(root, { finePointer: true, reducedMotion: false });
  const card = makeCard();

  root.dispatch("pointermove", {
    target: targetFor(card),
    pointerType: "mouse",
    clientX: 150,
    clientY: 250,
  });

  assert.equal(card.style.values.get("--spotlight-x"), "25%");
  assert.equal(card.style.values.get("--spotlight-y"), "50%");
  assert.equal(card.dataset.spotlightActive, "true");

  root.dispatch("pointerout", { target: targetFor(card), relatedTarget: null });
  assert.equal(card.dataset.spotlightActive, undefined);
  stop();
});

test("inspector spotlight clamps out-of-bounds pointer positions and clears on touch", () => {
  const root = new FakeRoot();
  initInspectorSpotlight(root, { finePointer: true, reducedMotion: false });
  const card = makeCard();

  root.dispatch("pointermove", {
    target: targetFor(card),
    pointerType: "mouse",
    clientX: 500,
    clientY: 100,
  });
  assert.equal(card.style.values.get("--spotlight-x"), "100%");
  assert.equal(card.style.values.get("--spotlight-y"), "0%");

  root.dispatch("pointermove", {
    target: targetFor(card),
    pointerType: "touch",
    clientX: 150,
    clientY: 250,
  });
  assert.equal(card.dataset.spotlightActive, undefined);
});

test("inspector spotlight is disabled for coarse pointers and reduced motion", () => {
  for (const options of [
    { finePointer: false, reducedMotion: false },
    { finePointer: true, reducedMotion: true },
  ]) {
    const root = new FakeRoot();
    const stop = initInspectorSpotlight(root, options);
    assert.equal(root.listeners.size, 0);
    stop();
  }
});

test("zero-sized cards are ignored and cleanup removes listeners and active state", () => {
  const root = new FakeRoot();
  const stop = initInspectorSpotlight(root, { finePointer: true, reducedMotion: false });
  const card = makeCard({ width: 0 });

  root.dispatch("pointermove", {
    target: targetFor(card),
    pointerType: "mouse",
    clientX: 150,
    clientY: 250,
  });
  assert.equal(card.dataset.spotlightActive, undefined);

  const visibleCard = makeCard();
  root.dispatch("pointermove", {
    target: targetFor(visibleCard),
    pointerType: "mouse",
    clientX: 150,
    clientY: 250,
  });
  assert.equal(visibleCard.dataset.spotlightActive, "true");

  stop();
  assert.equal(visibleCard.dataset.spotlightActive, undefined);
  assert.equal(root.listeners.get("pointermove").size, 0);
});

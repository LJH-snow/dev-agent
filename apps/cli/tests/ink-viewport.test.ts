import assert from "node:assert/strict";
import test from "node:test";

import { InkViewportModel } from "../dist/ink/viewport.js";

test("Ink runtime starts at the live bottom of an empty viewport", () => {
  const viewport = new InkViewportModel();
  assert.deepEqual(viewport.snapshot(), {
    offset: 0,
    totalRows: 0,
    visibleRows: 0,
    followOutput: true,
    hiddenAbove: 0,
    hiddenBelow: 0,
    newOutput: 0,
  });
});

test("mouse-sized scroll moves a few rows and returns to live follow at the bottom", () => {
  const viewport = new InkViewportModel({ totalRows: 40, visibleRows: 10 });

  assert.deepEqual(viewport.scrollBy(-3), {
    offset: 27,
    totalRows: 40,
    visibleRows: 10,
    followOutput: false,
    hiddenAbove: 27,
    hiddenBelow: 3,
    newOutput: 0,
  });
  assert.deepEqual(viewport.scrollBy(1), {
    offset: 28,
    totalRows: 40,
    visibleRows: 10,
    followOutput: false,
    hiddenAbove: 28,
    hiddenBelow: 2,
    newOutput: 0,
  });
  assert.deepEqual(viewport.scrollBy(2), {
    offset: 30,
    totalRows: 40,
    visibleRows: 10,
    followOutput: true,
    hiddenAbove: 30,
    hiddenBelow: 0,
    newOutput: 0,
  });
});

test("PageUp and PageDown move by one visible page and End follows output", () => {
  const viewport = new InkViewportModel({ totalRows: 40, visibleRows: 10 });

  assert.deepEqual(viewport.pageUp(), {
    offset: 21,
    totalRows: 40,
    visibleRows: 10,
    followOutput: false,
    hiddenAbove: 21,
    hiddenBelow: 9,
    newOutput: 0,
  });
  assert.deepEqual(viewport.pageDown(), {
    offset: 30,
    totalRows: 40,
    visibleRows: 10,
    followOutput: true,
    hiddenAbove: 30,
    hiddenBelow: 0,
    newOutput: 0,
  });
  assert.deepEqual(viewport.home(), {
    offset: 0,
    totalRows: 40,
    visibleRows: 10,
    followOutput: false,
    hiddenAbove: 0,
    hiddenBelow: 30,
    newOutput: 0,
  });
  assert.deepEqual(viewport.end(), {
    offset: 30,
    totalRows: 40,
    visibleRows: 10,
    followOutput: true,
    hiddenAbove: 30,
    hiddenBelow: 0,
    newOutput: 0,
  });
});

test("new rows do not move a manually scrolled viewport", () => {
  const viewport = new InkViewportModel({ totalRows: 32, visibleRows: 8 });
  viewport.pageUp();

  assert.deepEqual(viewport.setContent(40, 8), {
    offset: 17,
    totalRows: 40,
    visibleRows: 8,
    followOutput: false,
    hiddenAbove: 17,
    hiddenBelow: 15,
    newOutput: 8,
  });
});

test("resize clamps the offset and keeps follow mode at the bottom", () => {
  const viewport = new InkViewportModel({ totalRows: 40, visibleRows: 10 });
  viewport.pageUp();
  viewport.setContent(40, 20);

  assert.deepEqual(viewport.snapshot(), {
    offset: 20,
    totalRows: 40,
    visibleRows: 20,
    followOutput: false,
    hiddenAbove: 20,
    hiddenBelow: 0,
    newOutput: 0,
  });
});

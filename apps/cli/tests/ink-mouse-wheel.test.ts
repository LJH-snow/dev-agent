import assert from "node:assert/strict";
import test from "node:test";

import {
  MOUSE_TRACKING_DISABLE,
  MOUSE_TRACKING_ENABLE,
  MouseInputParser,
  mouseWheelDirections,
} from "../dist/ink/mouse-wheel.js";

test("mouse wheel parser recognizes SGR up and down events", () => {
  assert.deepEqual(
    mouseWheelDirections("\u001b[<64;14;9M\u001b[<65;14;9M"),
    ["up", "down"],
  );
});

test("mouse wheel parser recognizes Ink's ESC-stripped SGR input", () => {
  assert.deepEqual(
    mouseWheelDirections("[<64;14;9M[<65;14;9M"),
    ["up", "down"],
  );
});

test("mouse wheel parser recognizes legacy X10 events and ignores clicks", () => {
  const up = `\u001b[M${String.fromCharCode(96)}${String.fromCharCode(42)}${String.fromCharCode(18)}`;
  const down = `\u001b[M${String.fromCharCode(97)}${String.fromCharCode(42)}${String.fromCharCode(18)}`;
  const click = `\u001b[M${String.fromCharCode(0)}${String.fromCharCode(42)}${String.fromCharCode(18)}`;

  assert.deepEqual(mouseWheelDirections(up + click + down), ["up", "down"]);
});

test("mouse input parser consumes SGR button and release events", () => {
  const parser = new MouseInputParser();

  assert.deepEqual(parser.push("[<0;38;9M"), {
    consumed: true,
    directions: [],
    remaining: "",
  });
  assert.deepEqual(parser.push("\u001b[<0;38;9m"), {
    consumed: true,
    directions: [],
    remaining: "",
  });
  assert.deepEqual(parser.push("hello"), {
    consumed: false,
    directions: [],
    remaining: "hello",
  });
});

test("mouse input parser consumes Ink-split X10 packets and preserves following text", () => {
  const parser = new MouseInputParser();
  const payload = `${String.fromCharCode(96)}${String.fromCharCode(42)}${String.fromCharCode(18)}`;

  assert.deepEqual(parser.push("[M"), {
    consumed: true,
    directions: [],
    remaining: "",
  });
  assert.deepEqual(parser.push(`${payload}x`), {
    consumed: true,
    directions: ["up"],
    remaining: "x",
  });
});

test("mouse tracking control sequences are symmetric", () => {
  assert.equal(MOUSE_TRACKING_ENABLE, "\u001b[?1000h\u001b[?1006h");
  assert.equal(MOUSE_TRACKING_DISABLE, "\u001b[?1006l\u001b[?1000l");
});

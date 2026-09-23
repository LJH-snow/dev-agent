import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "ink";

import {
  CommandPalette,
  COMMAND_PULSE_FRAMES,
  commandPaletteFrame,
} from "../dist/ink/command-palette.js";

const COMMANDS = Array.from({ length: 8 }, (_, index) => ({
  command: `:command-${index + 1}`,
  description: `Description ${index + 1}`,
}));

test("command palette pulse frames cycle and wrap", () => {
  assert.ok(COMMAND_PULSE_FRAMES.length >= 3);
  assert.notEqual(commandPaletteFrame(0), commandPaletteFrame(1));
  assert.equal(
    commandPaletteFrame(COMMAND_PULSE_FRAMES.length),
    commandPaletteFrame(0),
  );
});

test("command palette highlights the Tab target and caps visible commands", () => {
  const output = renderToString(
    createElement(CommandPalette, {
      suggestions: COMMANDS,
      columns: 80,
      frameIndex: 1,
    }),
    { columns: 80 },
  );

  assert.match(output, /COMMANDS \/\/ DECK/);
  assert.match(output, /✧/);
  assert.match(output, /› :command-1/);
  assert.match(output, /:command-6/);
  assert.doesNotMatch(output, /:command-7/);
});

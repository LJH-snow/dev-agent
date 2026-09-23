import assert from "node:assert/strict";
import test from "node:test";

import {
  INK_THEME_NAMES,
  getInkTheme,
  parseInkThemeCommand,
  parseInkTheme,
} from "../dist/ink/theme.js";

test("theme lookup exposes signal, mono, and ember palettes", () => {
  assert.deepEqual(INK_THEME_NAMES, ["signal", "mono", "ember"]);
  assert.equal(parseInkTheme("EMBER"), "ember");
  assert.equal(parseInkTheme("not-a-theme"), undefined);
  assert.equal(getInkTheme().name, "signal");
  assert.notEqual(getInkTheme("signal").accent, getInkTheme("ember").accent);
});

test("theme command accepts aliases and rejects invalid selectors", () => {
  assert.deepEqual(parseInkThemeCommand(":theme"), {
    handled: true,
    name: undefined,
  });
  assert.deepEqual(parseInkThemeCommand("/theme ember"), {
    handled: true,
    name: "ember",
  });
  assert.equal(parseInkThemeCommand(":theme unknown").handled, true);
  assert.equal(parseInkThemeCommand(":not-theme").handled, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Writable } from "node:stream";
import { createElement } from "react";
import { render, Text } from "ink";

import {
  INK_FOCUS_IDS,
  resolveInkFocusOwner,
  useInkFocusRouter,
  type InkFocusState,
} from "../dist/ink/focus-router.js";

function createInkTerminal(): {
  stdin: PassThrough & NodeJS.ReadStream;
  stdout: Writable & NodeJS.WriteStream;
  writes: string[];
} {
  const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
  Object.assign(stdin, {
    isTTY: true,
    setRawMode: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  });
  const writes: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      writes.push(String(chunk));
      callback();
    },
  }) as Writable & NodeJS.WriteStream;
  Object.assign(stdout, {
    isTTY: true,
    columns: 80,
    rows: 24,
  });
  return { stdin, stdout, writes };
}

const emptyFocusState: InkFocusState = {
  activeInputPrompt: false,
  sessionPicker: false,
  pathCompletion: false,
  commandPalette: false,
  retry: false,
};

test("focus owner resolution preserves modal priority", () => {
  const cases: Array<[string, Partial<InkFocusState>, keyof typeof INK_FOCUS_IDS]> = [
    ["composer", {}, "composer"],
    ["retry", { retry: true }, "retry"],
    ["command palette", { commandPalette: true, retry: true }, "commandPalette"],
    ["path completion", { pathCompletion: true, commandPalette: true }, "pathCompletion"],
    ["session picker", { sessionPicker: true, pathCompletion: true }, "sessionPicker"],
    ["input prompt", { activeInputPrompt: true, sessionPicker: true }, "prompt"],
  ];

  for (const [label, partial, expected] of cases) {
    assert.equal(
      resolveInkFocusOwner({ ...emptyFocusState, ...partial }),
      expected,
      `${label} should own input`,
    );
  }
});

function FocusProbe({ state }: { readonly state: InkFocusState }): React.JSX.Element {
  const { owner, activeId } = useInkFocusRouter(state);
  return createElement(Text, null, `${owner}:${activeId ?? "none"}`);
}

test("Ink focus registration follows the active owner across mode changes", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const instance = render(
    createElement(FocusProbe, { state: emptyFocusState }),
    {
      stdin,
      stdout,
      stderr: stdout,
      debug: true,
      exitOnCtrlC: false,
    },
  );

  try {
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.match(writes.join(""), /composer:ink-composer/);

    instance.rerender(createElement(FocusProbe, {
      state: { ...emptyFocusState, commandPalette: true },
    }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.match(writes.join(""), /commandPalette:ink-command-palette/);

    instance.rerender(createElement(FocusProbe, {
      state: { ...emptyFocusState, activeInputPrompt: true },
    }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.match(writes.join(""), /prompt:ink-prompt/);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

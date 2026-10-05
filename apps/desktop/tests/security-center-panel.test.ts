import assert from "node:assert/strict";
import test from "node:test";

const here = new URL(".", import.meta.url);
const panelModule = await import(new URL("../public/security-center.js", here).href);

type StubElement = {
  textContent: string;
  value: string;
  title: string;
  hidden: boolean;
  disabled: boolean;
  dataset: Record<string, string>;
  appended: unknown[];
  replaced: number;
  addEventListener: (event: string, handler: () => void) => void;
  replaceChildren: () => void;
  append: (...children: unknown[]) => void;
  clickHandlers: Record<string, () => void>;
};

function stubElement(id: string): StubElement {
  const element: StubElement = {
    textContent: "",
    value: "",
    title: "",
    hidden: true,
    disabled: false,
    dataset: {},
    appended: [],
    replaced: 0,
    clickHandlers: {},
    addEventListener(event, handler) {
      element.clickHandlers[event] = handler;
    },
    replaceChildren() {
      element.replaced++;
    },
    append(...children: unknown[]) {
      element.appended.push(...children);
    },
  };
  return element;
}

function fakeDocument(ids: Record<string, StubElement>) {
  return {
    getElementById: (id: string) => ids[id],
    createElement: () => stubElement("created"),
    defaultView: undefined,
  };
}

function buildPanel(fetcher: (input: string, init?: any) => Promise<any>) {
  const ids: Record<string, StubElement> = {};
  for (const id of [
    "security-center-status",
    "security-center-summary",
    "security-center-list",
    "security-center-refresh",
    "security-center-run-scan",
    "security-center-clear",
    "security-center-clear-status",
    "security-center-session",
    "security-center-findings",
    "security-center-findings-title",
    "security-center-findings-list",
  ]) {
    ids[id] = stubElement(id);
  }
  const documentRef = fakeDocument(ids);
  const ui = panelModule.createSecurityCenterUI({
    documentRef,
    fetcher,
    translate: (key: string) => key,
  });
  return { ui, ids };
}

test("security panel keeps rendering history when the session listing fails", async () => {
  let sessionCalls = 0;
  const { ui, ids } = buildPanel((input: string) => {
    if (String(input).includes("/api/sessions")) {
      sessionCalls++;
      return Promise.reject(new Error("session list unavailable"));
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ history: [{ scanId: "scan-a", status: "clean", startedAt: "2026-10-06T00:00:00.000Z", durationMs: 5, filesScanned: 1, bytesScanned: 2, skippedEntries: 0, findingCount: 0, severityCounts: { high: 0, medium: 0, low: 0 }, categoryCounts: { secret: 0, "sensitive-file": 0, mcp: 0, "workspace-boundary": 0 } }] }),
    });
  });

  await ui.refresh();
  assert.equal(sessionCalls, 1);
  assert.equal(ids["security-center-session"].title, "securityCenter.sessionError");
  assert.equal(ids["security-center-status"].textContent, "", "history load must not be marked as errored");
  assert.equal(ids["security-center-list"].appended.length, 1, "history records still render");
});

test("security panel clears the scope note and restores selection when sessions recover", async () => {
  let sessionsOk = false;
  const { ui, ids } = buildPanel((input: string) => {
    if (String(input).includes("/api/sessions")) {
      if (!sessionsOk) return Promise.reject(new Error("session list unavailable"));
      return Promise.resolve({
        ok: true,
        json: async () => ({ sessions: [{ sessionId: "task-one" }, { sessionId: "task-two" }] }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ history: [] }) });
  });

  await ui.refresh();
  const select = ids["security-center-session"];
  assert.equal(select.title, "securityCenter.sessionError");

  select.value = "task-one";
  sessionsOk = true;
  await ui.refresh();
  assert.equal(select.title, "", "recovered listing clears the scoped note");
  assert.equal(select.value, "task-one", "selection survives a refresh");
  assert.equal(select.appended.length, 2, "both session options are rendered");
});

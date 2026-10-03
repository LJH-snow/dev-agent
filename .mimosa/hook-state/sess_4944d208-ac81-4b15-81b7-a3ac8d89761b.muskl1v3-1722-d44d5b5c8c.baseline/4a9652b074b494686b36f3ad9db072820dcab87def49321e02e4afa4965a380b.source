export const TASK_TEMPLATE_STORAGE_KEY = "dev-agent.task-templates";
export const TASK_TEMPLATE_STORAGE_VERSION = 1;
export const MAX_CUSTOM_TASK_TEMPLATES = 24;
export const MAX_TASK_TEMPLATE_NAME_CHARS = 80;
export const MAX_TASK_TEMPLATE_PROMPT_CHARS = 12000;
export const MAX_TASK_TEMPLATE_STORAGE_BYTES = 96 * 1024;
export const MAX_TASK_TEMPLATE_QUERY_CHARS = 128;

const TEMPLATE_MODES = new Set(["normal", "plan"]);
const CUSTOM_TEMPLATE_ID_PATTERN = /^custom-[a-z0-9][a-z0-9-]{0,63}$/;

export const BUILTIN_TASK_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "fix-bug",
    kind: "builtin",
    shortcut: "1",
    titleKey: "templates.builtin.fixBug.title",
    descriptionKey: "templates.builtin.fixBug.description",
    defaultMode: "normal",
    prompt: Object.freeze({
      en: "Investigate and fix this bug.\n\nProblem:\n\nExpected behavior:\n\nActual behavior:\n\nReproduction steps:\n1.\n\nConstraints:\n- Keep the change scoped.\n- Add or update focused tests.",
      zh: "请调查并修复这个 Bug。\n\n问题：\n\n预期行为：\n\n实际行为：\n\n复现步骤：\n1.\n\n约束：\n- 保持改动范围清晰。\n- 添加或更新针对性测试。",
    }),
  }),
  Object.freeze({
    id: "implement-feature",
    kind: "builtin",
    shortcut: "2",
    titleKey: "templates.builtin.feature.title",
    descriptionKey: "templates.builtin.feature.description",
    defaultMode: "plan",
    prompt: Object.freeze({
      en: "Implement this feature.\n\nUser outcome:\n\nAcceptance criteria:\n1.\n\nConstraints:\n- Inspect the existing architecture before editing.\n- Keep the implementation bounded and testable.\n- Report verification evidence.",
      zh: "请实现这个功能。\n\n用户目标：\n\n验收标准：\n1.\n\n约束：\n- 编辑前先检查现有架构。\n- 保持实现有边界且可测试。\n- 最后报告验证证据。",
    }),
  }),
  Object.freeze({
    id: "run-tests",
    kind: "builtin",
    shortcut: "3",
    titleKey: "templates.builtin.tests.title",
    descriptionKey: "templates.builtin.tests.description",
    defaultMode: "normal",
    prompt: Object.freeze({
      en: "Run the relevant tests for the current work. If anything fails, diagnose the root cause, make the smallest correct fix, and rerun the focused checks. Summarize the commands and results.",
      zh: "请运行当前改动相关的测试。如果有失败，诊断根因，做出最小且正确的修复，然后重跑针对性检查。最后总结执行的命令和结果。",
    }),
  }),
  Object.freeze({
    id: "review-changes",
    kind: "builtin",
    shortcut: "4",
    titleKey: "templates.builtin.review.title",
    descriptionKey: "templates.builtin.review.description",
    defaultMode: "plan",
    prompt: Object.freeze({
      en: "Review the current changes as a careful code reviewer. Prioritize correctness, regressions, security, data loss, and missing tests. Do not modify files until you list actionable findings with file and line references.",
      zh: "请以严格代码审查者的视角检查当前改动。优先关注正确性、回归、安全性、数据丢失和缺失测试。在列出带文件和行号依据的可执行问题之前，不要修改文件。",
    }),
  }),
  Object.freeze({
    id: "explain-code",
    kind: "builtin",
    shortcut: "5",
    titleKey: "templates.builtin.explain.title",
    descriptionKey: "templates.builtin.explain.description",
    defaultMode: "normal",
    prompt: Object.freeze({
      en: "Explain how this code works. Start with the main execution path, then describe important data flow, boundaries, and failure cases. Point to the relevant files and symbols without changing files.",
      zh: "请解释这部分代码的工作方式。先说明主要执行路径，再描述重要的数据流、边界和失败场景。指出相关文件和符号，但不要修改文件。",
    }),
  }),
]);

export function localizedTaskTemplatePrompt(template, language = "en") {
  if (!template || typeof template !== "object") return "";
  if (template.kind === "builtin") {
    const prompt = template.prompt;
    if (!prompt || typeof prompt !== "object") return "";
    const preferred = language === "zh" ? prompt.zh : prompt.en;
    const fallback = prompt.en ?? prompt.zh;
    return typeof preferred === "string" ? preferred : typeof fallback === "string" ? fallback : "";
  }
  return typeof template.prompt === "string" ? template.prompt : "";
}

export function normalizeTaskTemplateMode(value) {
  return TEMPLATE_MODES.has(value) ? value : "normal";
}

export function normalizeTaskTemplateName(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TASK_TEMPLATE_NAME_CHARS);
}

export function normalizeTaskTemplatePrompt(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u0000/g, " ")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_TASK_TEMPLATE_PROMPT_CHARS);
}

export function normalizeTaskTemplateId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim().toLowerCase();
  return CUSTOM_TEMPLATE_ID_PATTERN.test(id) ? id : "";
}

export function normalizeTaskTemplateRecord(value, now = new Date().toISOString()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const id = normalizeTaskTemplateId(value.id);
  const name = normalizeTaskTemplateName(value.name);
  const prompt = normalizeTaskTemplatePrompt(value.prompt);
  if (!id || !name || !prompt) return undefined;
  const createdAt = normalizeTimestamp(value.createdAt) ?? now;
  const updatedAt = normalizeTimestamp(value.updatedAt) ?? createdAt;
  return {
    id,
    kind: "custom",
    name,
    prompt,
    defaultMode: normalizeTaskTemplateMode(value.defaultMode),
    createdAt,
    updatedAt,
  };
}

export function filterTaskTemplates(templates, query = "") {
  const source = Array.isArray(templates) ? templates : [];
  const normalized = String(query ?? "").slice(0, MAX_TASK_TEMPLATE_QUERY_CHARS).trim().toLocaleLowerCase();
  if (!normalized) return source.slice();
  return source.filter((template) => {
    const text = [
      template?.name,
      template?.titleKey,
      template?.descriptionKey,
      localizedTaskTemplatePrompt(template, "en"),
      localizedTaskTemplatePrompt(template, "zh"),
    ].filter((part) => typeof part === "string").join(" ").toLocaleLowerCase();
    return text.includes(normalized);
  });
}

export function createTaskTemplateStore({
  storage,
  storageKey = TASK_TEMPLATE_STORAGE_KEY,
  now = () => new Date().toISOString(),
  idFactory = () => `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
} = {}) {
  let customTemplates = readTemplates(storage, storageKey, now);

  function list() {
    return customTemplates.map((template) => ({ ...template }));
  }

  function persist() {
    if (!storage || typeof storage.setItem !== "function") return false;
    const bounded = customTemplates.slice(0, MAX_CUSTOM_TASK_TEMPLATES);
    while (bounded.length > 0 && serializedBytes(bounded) > MAX_TASK_TEMPLATE_STORAGE_BYTES) bounded.pop();
    customTemplates = bounded;
    try {
      storage.setItem(storageKey, JSON.stringify({
        version: TASK_TEMPLATE_STORAGE_VERSION,
        templates: bounded,
      }));
      return true;
    } catch {
      return false;
    }
  }

  function upsert(input) {
    const currentTime = now();
    const candidateId = normalizeTaskTemplateId(input?.id) || normalizeGeneratedId(idFactory());
    const normalized = normalizeTaskTemplateRecord({
      ...input,
      id: candidateId,
      createdAt: input?.createdAt,
      updatedAt: currentTime,
    }, currentTime);
    if (!normalized) return { ok: false, reason: "invalid" };
    const existingIndex = customTemplates.findIndex((template) => template.id === normalized.id);
    if (existingIndex < 0 && customTemplates.length >= MAX_CUSTOM_TASK_TEMPLATES) {
      return { ok: false, reason: "limit" };
    }
    if (existingIndex >= 0) {
      normalized.createdAt = customTemplates[existingIndex].createdAt;
      customTemplates.splice(existingIndex, 1);
    }
    customTemplates.unshift(normalized);
    const persisted = persist();
    return { ok: true, persisted, template: { ...normalized } };
  }

  function remove(id) {
    const normalizedId = normalizeTaskTemplateId(id);
    const before = customTemplates.length;
    customTemplates = customTemplates.filter((template) => template.id !== normalizedId);
    if (customTemplates.length === before) return { ok: false, reason: "not_found" };
    return { ok: true, persisted: persist() };
  }

  function reset() {
    customTemplates = [];
    return { ok: true, persisted: persist() };
  }

  return {
    list,
    upsert,
    remove,
    reset,
    reload() {
      customTemplates = readTemplates(storage, storageKey, now);
      return list();
    },
  };
}

function readTemplates(storage, storageKey, now) {
  if (!storage || typeof storage.getItem !== "function") return [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) || "null");
    const source = Array.isArray(parsed) ? parsed : parsed?.templates;
    if (!Array.isArray(source)) return [];
    const seen = new Set();
    return source
      .slice(0, MAX_CUSTOM_TASK_TEMPLATES)
      .map((value) => normalizeTaskTemplateRecord(value, now()))
      .filter((template) => {
        if (!template || seen.has(template.id)) return false;
        seen.add(template.id);
        return true;
      });
  } catch {
    return [];
  }
}

function normalizeGeneratedId(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (CUSTOM_TEMPLATE_ID_PATTERN.test(normalized)) return normalized;
  return `custom-${Date.now().toString(36)}`;
}

function normalizeTimestamp(value) {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function serializedBytes(templates) {
  return new TextEncoder().encode(JSON.stringify({
    version: TASK_TEMPLATE_STORAGE_VERSION,
    templates,
  })).byteLength;
}

export function createTaskTemplateUI({
  documentRef,
  translate,
  getLanguage = () => "en",
  getPrompt = () => "",
  setPrompt = () => {},
  getMode = () => "normal",
  setMode = () => {},
  focusPrompt = () => {},
  confirmAction = (message) => globalThis.confirm?.(message) ?? true,
  storage,
} = {}) {
  const noOp = {
    render() {},
    refresh() {},
    open() {},
    close() {},
    toggle() {},
    apply() { return false; },
    handleShortcut() { return false; },
    isOpen: () => false,
  };
  if (!documentRef || typeof documentRef.getElementById !== "function") return noOp;

  const palette = documentRef.getElementById("task-template-palette");
  const toggleButton = documentRef.getElementById("task-template-toggle");
  const closeButton = documentRef.getElementById("task-template-close");
  const searchInput = documentRef.getElementById("task-template-search");
  const list = documentRef.getElementById("task-template-list");
  const status = documentRef.getElementById("task-template-status");
  const saveName = documentRef.getElementById("task-template-name");
  const savePrompt = documentRef.getElementById("task-template-prompt");
  const saveMode = documentRef.getElementById("task-template-mode");
  const saveButton = documentRef.getElementById("task-template-save");
  if (!palette || !toggleButton || !list) return noOp;

  const safeStorage = storage ?? readLocalStorage();
  const store = createTaskTemplateStore({ storage: safeStorage });
  let open = false;
  let query = "";

  const setStatus = (key, values = {}) => {
    if (status) status.textContent = translate?.(key, values) ?? key;
  };

  function allTemplates() {
    return [...BUILTIN_TASK_TEMPLATES, ...store.list()];
  }

  function titleFor(template) {
    return template.kind === "builtin"
      ? translate?.(template.titleKey) ?? template.id
      : template.name;
  }

  function descriptionFor(template) {
    if (template.kind === "builtin") return translate?.(template.descriptionKey) ?? "";
    const prompt = localizedTaskTemplatePrompt(template, getLanguage());
    return prompt.length > 180 ? `${prompt.slice(0, 177)}…` : prompt;
  }

  function modeLabel(mode) {
    const key = mode === "plan" ? "composer.plan" : "composer.execute";
    return translate?.(key) ?? mode;
  }

  function renderCard(template) {
    const item = documentRef.createElement("article");
    item.className = "task-template-card";
    item.dataset.templateId = template.id;
    item.dataset.templateKind = template.kind;

    const content = documentRef.createElement("div");
    content.className = "task-template-card-content";
    const heading = documentRef.createElement("strong");
    heading.className = "task-template-card-title";
    heading.textContent = titleFor(template);
    const description = documentRef.createElement("span");
    description.className = "task-template-card-description";
    description.textContent = descriptionFor(template);
    content.append(heading, description);

    const meta = documentRef.createElement("span");
    meta.className = "task-template-card-meta";
    const shortcut = template.kind === "builtin" && template.shortcut
      ? translate?.("templates.palette.shortcut", { key: template.shortcut }) ?? `⌘/Ctrl+Shift+${template.shortcut}`
      : "";
    meta.textContent = [modeLabel(template.defaultMode), shortcut].filter(Boolean).join(" · ");

    const actions = documentRef.createElement("div");
    actions.className = "task-template-card-actions";
    const useButton = documentRef.createElement("button");
    useButton.type = "button";
    useButton.className = "task-template-use";
    useButton.dataset.templateAction = "use";
    useButton.dataset.templateId = template.id;
    useButton.textContent = translate?.("templates.palette.use") ?? "Use";
    actions.appendChild(useButton);
    if (template.kind === "custom") {
      const deleteButton = documentRef.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "task-template-delete";
      deleteButton.dataset.templateAction = "delete";
      deleteButton.dataset.templateId = template.id;
      deleteButton.textContent = translate?.("templates.palette.delete") ?? "Delete";
      actions.appendChild(deleteButton);
    }

    item.append(content, meta, actions);
    return item;
  }

  function render() {
    palette.hidden = !open;
    toggleButton.setAttribute("aria-expanded", String(open));
    if (!open) return;
    const filtered = filterTaskTemplates(allTemplates(), query);
    list.replaceChildren();
    let lastKind = "";
    for (const template of filtered) {
      if (template.kind !== lastKind) {
        const heading = documentRef.createElement("div");
        heading.className = "task-template-group-label";
        heading.textContent = translate?.(template.kind === "builtin" ? "templates.palette.builtIn" : "templates.palette.custom") ?? template.kind;
        list.appendChild(heading);
        lastKind = template.kind;
      }
      list.appendChild(renderCard(template));
    }
    if (filtered.length === 0) {
      const empty = documentRef.createElement("div");
      empty.className = "task-template-empty";
      empty.textContent = translate?.("templates.palette.empty") ?? "No templates match this search.";
      list.appendChild(empty);
    }
    if (saveMode) saveMode.value = normalizeTaskTemplateMode(getMode());
  }

  function openPalette() {
    open = true;
    if (savePrompt && !savePrompt.value.trim()) {
      const current = String(getPrompt?.() ?? "").trim();
      if (current) savePrompt.value = current.slice(0, MAX_TASK_TEMPLATE_PROMPT_CHARS);
    }
    render();
    queueMicrotask(() => searchInput?.focus());
  }

  function closePalette({ restoreFocus = true } = {}) {
    open = false;
    render();
    if (restoreFocus) toggleButton.focus?.();
  }

  function apply(templateId) {
    const template = allTemplates().find((candidate) => candidate.id === templateId);
    if (!template) return false;
    const prompt = localizedTaskTemplatePrompt(template, getLanguage());
    if (!prompt) return false;
    const current = String(getPrompt?.() ?? "").trim();
    setPrompt(current ? `${current}\n\n${prompt}` : prompt);
    setMode(normalizeTaskTemplateMode(template.defaultMode));
    setStatus("templates.palette.inserted", { name: titleFor(template) });
    closePalette({ restoreFocus: false });
    focusPrompt();
    return true;
  }

  function saveCustom() {
    const name = normalizeTaskTemplateName(saveName?.value ?? "");
    const prompt = normalizeTaskTemplatePrompt(savePrompt?.value ?? "") || normalizeTaskTemplatePrompt(getPrompt?.() ?? "");
    const result = store.upsert({
      id: saveName?.dataset.editingId,
      name,
      prompt,
      defaultMode: normalizeTaskTemplateMode(saveMode?.value),
    });
    if (!result.ok) {
      setStatus(result.reason === "limit" ? "templates.palette.limit" : "templates.palette.required");
      return false;
    }
    if (saveName) {
      saveName.value = "";
      delete saveName.dataset.editingId;
    }
    if (savePrompt) savePrompt.value = "";
    render();
    setStatus("templates.palette.saved", { name: result.template.name });
    return true;
  }

  toggleButton.addEventListener("click", () => (open ? closePalette() : openPalette()));
  closeButton?.addEventListener("click", closePalette);
  searchInput?.addEventListener("input", () => {
    query = String(searchInput.value ?? "").slice(0, MAX_TASK_TEMPLATE_QUERY_CHARS);
    render();
  });
  list.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-template-action]") : null;
    const templateId = target?.getAttribute("data-template-id");
    const action = target?.getAttribute("data-template-action");
    if (!templateId || !action) return;
    if (action === "use") {
      apply(templateId);
      return;
    }
    if (action === "delete") {
      const template = store.list().find((candidate) => candidate.id === templateId);
      if (!template) return;
      const confirmed = confirmAction(translate?.("templates.palette.confirmDelete", { name: template.name }) ?? "Delete this template?");
      if (!confirmed) return;
      store.remove(templateId);
      render();
      setStatus("templates.palette.deleted", { name: template.name });
    }
  });
  saveButton?.addEventListener("click", saveCustom);
  documentRef.querySelectorAll("[data-template-quick]").forEach((button) => {
    button.addEventListener("click", () => apply(button.getAttribute("data-template-quick")));
  });

  return {
    render,
    refresh() {
      store.reload();
      render();
    },
    open: openPalette,
    close: closePalette,
    toggle() {
      if (open) closePalette();
      else openPalette();
    },
    apply,
    handleShortcut(event) {
      if (!event || event.defaultPrevented || event.altKey || (!event.metaKey && !event.ctrlKey)) return false;
      const key = String(event.key ?? "").toLowerCase();
      if (!event.repeat && key === "k") {
        event.preventDefault();
        if (open) closePalette();
        else openPalette();
        return true;
      }
      if (!event.repeat && event.shiftKey && /^[1-5]$/.test(key)) {
        event.preventDefault();
        return apply(BUILTIN_TASK_TEMPLATES[Number(key) - 1]?.id);
      }
      return false;
    },
    isOpen: () => open,
  };
}

function readLocalStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

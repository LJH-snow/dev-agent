const SETTINGS_STORAGE_KEYS = {
  section: "dev-agent-settings-section",
  theme: "dev-agent-theme",
  language: "dev-agent-language",
  composerMode: "dev-agent-composer-mode",
  inspectorCollapsed: "dev-agent.inspector-collapsed",
};

const SETTINGS_TRANSLATIONS = {
  en: {
    trigger: "Settings",
    triggerTitle: "Open settings",
    back: "Back to workspace",
    eyebrow: "Preferences",
    title: "Settings",
    subtitle: "Tune the local workbench without leaving your workspace.",
    searchLabel: "Search settings",
    searchPlaceholder: "Search settings",
    noResults: "No settings match this search.",
    general: "General",
    generalDescription: "Choose how new conversations start and keep track of the active session.",
    appearance: "Appearance",
    appearanceDescription: "Make the workbench feel right for your screen and language.",
    runtime: "Model & runtime",
    runtimeDescription: "Inspect the active runtime without exposing secrets or raw paths.",
    permissions: "Permissions",
    permissionsDescription: "Review the policies that guard tools, changes, and validation.",
    integrations: "Integrations",
    integrationsDescription: "See which local and repository capabilities are available.",
    about: "About",
    aboutDescription: "Understand the scope of this local-first desktop shell.",
    promptMode: "Default prompt mode",
    promptModeDescription: "The mode used for the next prompt unless you change it in the composer.",
    execute: "Execute",
    plan: "Plan",
    activeSession: "Active session",
    activeSessionDescription: "The conversation currently attached to this workbench.",
    inspector: "Keep Runtime Inspector open",
    inspectorDescription: "Show the inspector automatically when the workspace opens on a wide screen.",
    theme: "Theme",
    themeDescription: "Choose the visual theme used by the desktop shell.",
    dark: "Dark",
    light: "Light",
    system: "System",
    language: "Language",
    languageDescription: "Use English or Simplified Chinese throughout the workbench.",
    english: "English",
    chinese: "中文",
    metadataOnly: "Metadata only. Keys, secrets, raw errors, and full filesystem paths stay out of this view.",
    refreshRuntime: "Refresh runtime status",
    provider: "Provider",
    model: "Model",
    runtimeValue: "Runtime",
    approval: "Approval",
    validation: "Validation",
    mcp: "MCP",
    workspace: "Workspace",
    configured: "configured",
    connected: "connected",
    policy: "Policy",
    readOnly: "Read-only",
    permissionApprovalDescription: "Approval mode is supplied by the desktop session configuration. Tool actions still require the existing approval boundary.",
    permissionValidationDescription: "Validation policy is supplied by the project configuration. Settings do not invent or execute commands.",
    github: "GitHub",
    ci: "CI",
    repository: "Repository",
    remote: "Remote",
    monitoring: "Monitoring",
    capabilityDescription: "Capabilities are reported as metadata. Remote mutations and approvals stay in the active workspace.",
    product: "dev-agent Desktop",
    productDescription: "A local-first coordination surface for sessions, task worktrees, terminal runs, and validation.",
    scope: "Current scope",
    scopeDescription: "This first settings surface intentionally focuses on local UI preferences and transparent runtime metadata. Account sync, voice, browser automation, and plugin marketplace flows are not enabled here.",
    keyboard: "Keyboard",
    keyboardDescription: "Press Escape to return to the workspace.",
    version: "Desktop shell",
    local: "Local workbench",
    stateUnavailable: "Unavailable",
    stateNotLoaded: "Not loaded",
    stateOpen: "Open",
    stateClosed: "Closed",
  },
  zh: {
    trigger: "设置",
    triggerTitle: "打开设置",
    back: "返回工作区",
    eyebrow: "偏好设置",
    title: "设置",
    subtitle: "无需离开当前工作区，即可调整本地桌面端体验。",
    searchLabel: "搜索设置",
    searchPlaceholder: "搜索设置",
    noResults: "没有匹配此搜索的设置。",
    general: "常规",
    generalDescription: "选择新对话的默认方式，并查看当前会话。",
    appearance: "外观",
    appearanceDescription: "根据屏幕和语言偏好调整工作台。",
    runtime: "模型与运行时",
    runtimeDescription: "查看当前运行时状态，不暴露密钥、敏感信息或原始路径。",
    permissions: "权限",
    permissionsDescription: "查看工具、变更和验证所使用的安全策略。",
    integrations: "集成",
    integrationsDescription: "查看当前本地环境和仓库提供的能力。",
    about: "关于",
    aboutDescription: "了解这个本地优先桌面端的能力边界。",
    promptMode: "默认提示模式",
    promptModeDescription: "下一次发送提示词时使用的模式，也可以在输入区临时切换。",
    execute: "执行",
    plan: "计划",
    activeSession: "当前会话",
    activeSessionDescription: "当前工作台正在使用的对话会话。",
    inspector: "保持打开运行时检查器",
    inspectorDescription: "在宽屏工作区打开时自动显示右侧检查器。",
    theme: "主题",
    themeDescription: "选择桌面端使用的视觉主题。",
    dark: "深色",
    light: "浅色",
    system: "跟随系统",
    language: "语言",
    languageDescription: "在整个工作台中使用英文或简体中文。",
    english: "English",
    chinese: "中文",
    metadataOnly: "仅显示元数据。密钥、机密、原始错误和完整文件系统路径不会出现在这里。",
    refreshRuntime: "刷新运行时状态",
    provider: "提供方",
    model: "模型",
    runtimeValue: "运行时",
    approval: "审批",
    validation: "验证",
    mcp: "MCP",
    workspace: "工作区",
    configured: "已配置",
    connected: "已连接",
    policy: "策略",
    readOnly: "只读",
    permissionApprovalDescription: "审批模式由桌面会话配置提供。工具操作仍然会经过现有审批边界。",
    permissionValidationDescription: "验证策略由项目配置提供。设置页不会臆造或执行命令。",
    github: "GitHub",
    ci: "CI",
    repository: "仓库",
    remote: "远程",
    monitoring: "监控",
    capabilityDescription: "能力以元数据形式展示。远程变更和审批仍在当前工作区中完成。",
    product: "dev-agent 桌面端",
    productDescription: "面向会话、任务工作区、终端运行和验证流程的本地优先协作界面。",
    scope: "当前范围",
    scopeDescription: "第一版设置页聚焦本地 UI 偏好和透明的运行时元数据。账号同步、语音、浏览器自动化和插件市场流程暂未启用。",
    keyboard: "快捷键",
    keyboardDescription: "按 Escape 返回工作区。",
    version: "桌面端壳层",
    local: "本地工作台",
    stateUnavailable: "不可用",
    stateNotLoaded: "未加载",
    stateOpen: "打开",
    stateClosed: "关闭",
  },
};

const SECTION_DEFINITIONS = [
  { id: "general", translation: "general", icon: "⌘" },
  { id: "appearance", translation: "appearance", icon: "✦" },
  { id: "runtime", translation: "runtime", icon: "◈" },
  { id: "permissions", translation: "permissions", icon: "◇" },
  { id: "integrations", translation: "integrations", icon: "⌘" },
  { id: "about", translation: "about", icon: "i" },
];

const appShell = document.querySelector(".app-shell");
const headerStatus = document.querySelector(".header-status");
const stopButton = document.getElementById("stop");
const mainBridge = () => window.devAgentDesktop ?? {};

function getLanguage() {
  return String(document.documentElement.lang || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}

function translate(key) {
  return SETTINGS_TRANSLATIONS[getLanguage()]?.[key] ?? SETTINGS_TRANSLATIONS.en[key] ?? key;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readStorage(key, fallback = "") {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing contexts may reject localStorage; live settings still work.
  }
}

function currentThemePreference() {
  const bridge = mainBridge();
  if (typeof bridge.getThemePreference === "function") return bridge.getThemePreference();
  const stored = readStorage(SETTINGS_STORAGE_KEYS.theme, "dark");
  return ["dark", "light", "system"].includes(stored) ? stored : "dark";
}

function currentLanguagePreference() {
  const bridge = mainBridge();
  if (typeof bridge.getLanguagePreference === "function") return bridge.getLanguagePreference();
  return getLanguage();
}

function currentComposerMode() {
  const bridge = mainBridge();
  if (typeof bridge.getComposerMode === "function") return bridge.getComposerMode();
  return document.getElementById("composer-mode")?.value === "plan" ? "plan" : "normal";
}

function currentInspectorOpen() {
  const bridge = mainBridge();
  if (typeof bridge.getInspectorOpen === "function") return Boolean(bridge.getInspectorOpen());
  return document.getElementById("runtime-inspector")?.classList.contains("is-open") ?? false;
}

function currentSessionId() {
  const bridge = mainBridge();
  if (typeof bridge.getCurrentSessionId === "function") return bridge.getCurrentSessionId();
  return document.getElementById("conversation-session-id")?.textContent?.trim() || "—";
}

const settingsTrigger = document.createElement("button");
settingsTrigger.type = "button";
settingsTrigger.id = "settings-trigger";
settingsTrigger.className = "settings-trigger";
settingsTrigger.innerHTML = '<span class="settings-trigger-icon" aria-hidden="true">⚙</span><span class="settings-trigger-label"></span>';
settingsTrigger.addEventListener("click", () => openSettings());
if (headerStatus) {
  headerStatus.insertBefore(settingsTrigger, stopButton ?? null);
}

const settingsView = document.createElement("section");
settingsView.id = "settings-view";
settingsView.className = "settings-view";
settingsView.hidden = true;
settingsView.tabIndex = -1;
settingsView.setAttribute("role", "dialog");
settingsView.setAttribute("aria-modal", "true");
settingsView.setAttribute("aria-labelledby", "settings-title");
document.body.appendChild(settingsView);

let activeSection = SECTION_DEFINITIONS.some((section) => section.id === readStorage(SETTINGS_STORAGE_KEYS.section))
  ? readStorage(SETTINGS_STORAGE_KEYS.section)
  : "general";
let previousFocus = null;
let isOpen = false;

function settingValueCard(id, title, source, stateSource = "") {
  return `<div class="settings-value-card">
    <div class="settings-value-label">${escapeHtml(title)}</div>
    <strong id="${escapeHtml(id)}" class="settings-value-number">—</strong>
    <span id="${escapeHtml(`${id}-state`)}" class="settings-value-state">${escapeHtml(stateSource || translate("stateNotLoaded"))}</span>
    <span class="settings-value-source">${escapeHtml(source)}</span>
  </div>`;
}

function settingsCard(title, description, content, searchText = "") {
  return `<article class="settings-card" data-settings-card data-search="${escapeHtml(searchText || `${title} ${description}`)}">
    <div class="settings-card-heading">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
    </div>
    <div class="settings-card-content">${content}</div>
  </article>`;
}

function sectionShell(section, content) {
  return `<section class="settings-panel" data-settings-panel="${escapeHtml(section.id)}" aria-labelledby="settings-panel-${escapeHtml(section.id)}-title">
    <div class="settings-panel-heading">
      <span class="settings-panel-icon" aria-hidden="true">${escapeHtml(section.icon)}</span>
      <div>
        <h2 id="settings-panel-${escapeHtml(section.id)}-title">${escapeHtml(translate(`${section.translation}`))}</h2>
        <p>${escapeHtml(translate(`${section.translation}Description`))}</p>
      </div>
    </div>
    <div class="settings-card-stack">${content}</div>
  </section>`;
}

function renderSettingsView() {
  const themePreference = currentThemePreference();
  const languagePreference = currentLanguagePreference();
  const mode = currentComposerMode();
  const inspectorOpen = currentInspectorOpen();

  const navigation = SECTION_DEFINITIONS.map((section) => `<button type="button" class="settings-nav-item" data-settings-section="${escapeHtml(section.id)}" aria-current="${String(section.id === activeSection)}">
    <span class="settings-nav-icon" aria-hidden="true">${escapeHtml(section.icon)}</span>
    <span>${escapeHtml(translate(section.translation))}</span>
  </button>`).join("");

  const general = sectionShell(SECTION_DEFINITIONS[0], [
    settingsCard(
      translate("promptMode"),
      translate("promptModeDescription"),
      `<label class="settings-field-label" for="settings-composer-mode">${escapeHtml(translate("promptMode"))}</label>
       <select id="settings-composer-mode" class="settings-select">
         <option value="normal"${mode === "normal" ? " selected" : ""}>${escapeHtml(translate("execute"))}</option>
         <option value="plan"${mode === "plan" ? " selected" : ""}>${escapeHtml(translate("plan"))}</option>
       </select>`,
      `${translate("promptMode")} ${translate("execute")} ${translate("plan")}`
    ),
    settingsCard(
      translate("activeSession"),
      translate("activeSessionDescription"),
      `<div class="settings-readonly-row"><span id="settings-current-session" class="settings-readonly-value">${escapeHtml(String(currentSessionId() ?? "—"))}</span><span class="settings-readonly-badge">${escapeHtml(translate("local"))}</span></div>`,
      `${translate("activeSession")} session`
    ),
  ].join(""));

  const appearance = sectionShell(SECTION_DEFINITIONS[1], [
    settingsCard(
      translate("theme"),
      translate("themeDescription"),
      `<div class="settings-choice-group" role="group" aria-label="${escapeHtml(translate("theme"))}">
        ${[
          ["dark", translate("dark"), "◐"],
          ["light", translate("light"), "☼"],
          ["system", translate("system"), "◌"],
        ].map(([value, label, icon]) => `<button type="button" class="settings-choice" data-settings-theme="${value}" aria-pressed="${String(themePreference === value)}"><span aria-hidden="true">${icon}</span><span>${escapeHtml(label)}</span></button>`).join("")}
       </div>`,
      `${translate("theme")} ${translate("dark")} ${translate("light")} ${translate("system")}`
    ),
    settingsCard(
      translate("language"),
      translate("languageDescription"),
      `<div class="settings-choice-group" role="group" aria-label="${escapeHtml(translate("language"))}">
        <button type="button" class="settings-choice" data-settings-language="en" aria-pressed="${String(languagePreference === "en")}"><span aria-hidden="true">EN</span><span>${escapeHtml(translate("english"))}</span></button>
        <button type="button" class="settings-choice" data-settings-language="zh" aria-pressed="${String(languagePreference === "zh")}"><span aria-hidden="true">中</span><span>${escapeHtml(translate("chinese"))}</span></button>
       </div>`,
      `${translate("language")} ${translate("english")} ${translate("chinese")}`
    ),
    settingsCard(
      translate("inspector"),
      translate("inspectorDescription"),
      `<label class="settings-toggle-row" for="settings-inspector-open" aria-label="${escapeHtml(translate("inspector"))}"><span class="settings-toggle-copy"><span id="settings-inspector-state">${escapeHtml(inspectorOpen ? translate("stateOpen") : translate("stateClosed"))}</span></span><span class="settings-toggle"><input id="settings-inspector-open" type="checkbox"${inspectorOpen ? " checked" : ""} /><span class="settings-toggle-track" aria-hidden="true"><span></span></span></span></label>`,
      `${translate("inspector")} ${translate("appearance")}`
    ),
  ].join(""));

  const runtime = sectionShell(SECTION_DEFINITIONS[2], [
    settingsCard(
      translate("runtime"),
      translate("metadataOnly"),
      `<div class="settings-value-grid">
        ${settingValueCard("settings-runtime-provider", translate("provider"), translate("readOnly"))}
        ${settingValueCard("settings-runtime-model", translate("model"), translate("readOnly"))}
        ${settingValueCard("settings-runtime-runtime", translate("runtimeValue"), translate("readOnly"))}
        ${settingValueCard("settings-runtime-mcp", translate("mcp"), translate("readOnly"))}
        ${settingValueCard("settings-runtime-workspace", translate("workspace"), translate("readOnly"))}
      </div>
      <div class="settings-inline-actions"><span class="settings-inline-note">${escapeHtml(translate("metadataOnly"))}</span><button type="button" id="settings-runtime-refresh" class="settings-secondary-button">${escapeHtml(translate("refreshRuntime"))}</button></div>`,
      `${translate("runtime")} ${translate("provider")} ${translate("model")} ${translate("mcp")}`
    ),
  ].join(""));

  const permissions = sectionShell(SECTION_DEFINITIONS[3], [
    settingsCard(
      translate("approval"),
      translate("permissionApprovalDescription"),
      `<div class="settings-value-grid settings-value-grid-compact">
        ${settingValueCard("settings-permission-approval", translate("approval"), translate("policy"))}
      </div>`,
      `${translate("permissions")} ${translate("approval")} ${translate("policy")}`
    ),
    settingsCard(
      translate("validation"),
      translate("permissionValidationDescription"),
      `<div class="settings-value-grid settings-value-grid-compact">
        ${settingValueCard("settings-permission-validation", translate("validation"), translate("policy"))}
      </div>`,
      `${translate("permissions")} ${translate("validation")} ${translate("policy")}`
    ),
  ].join(""));

  const integrations = sectionShell(SECTION_DEFINITIONS[4], [
    settingsCard(
      translate("integrations"),
      translate("capabilityDescription"),
      `<div class="settings-value-grid">
        ${settingValueCard("settings-capability-github", translate("github"), translate("readOnly"))}
        ${settingValueCard("settings-capability-ci", translate("ci"), translate("readOnly"))}
        ${settingValueCard("settings-capability-repository", translate("repository"), translate("readOnly"))}
        ${settingValueCard("settings-capability-remote", translate("remote"), translate("readOnly"))}
        ${settingValueCard("settings-capability-monitoring", translate("monitoring"), translate("readOnly"))}
      </div>`,
      `${translate("integrations")} ${translate("github")} ${translate("ci")} ${translate("repository")} ${translate("remote")}`
    ),
  ].join(""));

  const about = sectionShell(SECTION_DEFINITIONS[5], [
    settingsCard(
      translate("product"),
      translate("productDescription"),
      `<div class="settings-about-grid"><div><span class="settings-about-label">${escapeHtml(translate("version"))}</span><strong>dev-agent Desktop</strong></div><div><span class="settings-about-label">${escapeHtml(translate("activeSession"))}</span><strong id="settings-about-session">${escapeHtml(String(currentSessionId() ?? "—"))}</strong></div></div>`,
      `${translate("about")} ${translate("product")} ${translate("version")}`
    ),
    settingsCard(
      translate("scope"),
      translate("scopeDescription"),
      `<div class="settings-note"><span class="settings-note-mark" aria-hidden="true">i</span><span>${escapeHtml(translate("scopeDescription"))}</span></div>`,
      `${translate("scope")} ${translate("local")}`
    ),
    settingsCard(
      translate("keyboard"),
      translate("keyboardDescription"),
      `<kbd>Esc</kbd>`,
      `${translate("keyboard")} Escape Esc`
    ),
  ].join(""));

  settingsView.innerHTML = `<div class="settings-topbar">
    <div class="settings-topbar-brand"><span class="settings-topbar-mark" aria-hidden="true">✦</span><div><span class="settings-eyebrow">${escapeHtml(translate("eyebrow"))}</span><strong>dev-agent</strong></div></div>
    <button type="button" id="settings-back" class="settings-back-button"><span aria-hidden="true">←</span><span>${escapeHtml(translate("back"))}</span></button>
  </div>
  <div class="settings-layout">
    <aside class="settings-sidebar" aria-label="${escapeHtml(translate("searchLabel"))}">
      <div class="settings-sidebar-heading"><span class="settings-eyebrow">${escapeHtml(translate("eyebrow"))}</span><strong>${escapeHtml(translate("title"))}</strong></div>
      <label class="settings-search-wrap"><span class="settings-search-icon" aria-hidden="true">⌕</span><span class="sr-only">${escapeHtml(translate("searchLabel"))}</span><input id="settings-search" type="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(translate("searchPlaceholder"))}" aria-label="${escapeHtml(translate("searchLabel"))}" /></label>
      <nav class="settings-nav" aria-label="${escapeHtml(translate("title"))}">${navigation}</nav>
    </aside>
    <main class="settings-content">
      <div class="settings-content-inner">
        <header class="settings-content-heading"><span class="settings-eyebrow">${escapeHtml(translate("eyebrow"))}</span><h1 id="settings-title">${escapeHtml(translate("title"))}</h1><p>${escapeHtml(translate("subtitle"))}</p></header>
        <div id="settings-panels" class="settings-panels">${general}${appearance}${runtime}${permissions}${integrations}${about}</div>
        <div id="settings-no-results" class="settings-no-results" hidden><span aria-hidden="true">⌕</span><strong>${escapeHtml(translate("noResults"))}</strong></div>
      </div>
    </main>
  </div>`;

  bindSettingsEvents();
  refreshRuntimeValues();
  applySettingsFilter();
}

function textFrom(id) {
  return document.getElementById(id)?.textContent?.trim() || "—";
}

function setSettingsValue(id, value, state = "") {
  const valueNode = document.getElementById(id);
  const stateNode = document.getElementById(`${id}-state`);
  if (valueNode) valueNode.textContent = value || "—";
  if (stateNode) stateNode.textContent = state || translate("stateUnavailable");
}

function refreshRuntimeValues() {
  if (!isOpen) return;
  setSettingsValue("settings-runtime-provider", textFrom("desktop-status-provider"), textFrom("desktop-status-provider-state"));
  setSettingsValue("settings-runtime-model", textFrom("desktop-status-model"), textFrom("desktop-status-model-state"));
  setSettingsValue("settings-runtime-runtime", textFrom("desktop-status-runtime"), textFrom("desktop-status-runtime-state"));
  setSettingsValue("settings-runtime-mcp", textFrom("desktop-status-mcp"), textFrom("desktop-status-mcp-state"));
  setSettingsValue("settings-runtime-workspace", textFrom("desktop-status-workspace"), textFrom("desktop-status-workspace") === "—" ? translate("stateNotLoaded") : translate("readOnly"));
  setSettingsValue("settings-permission-approval", textFrom("desktop-status-approval"), textFrom("desktop-status-approval-state"));
  setSettingsValue("settings-permission-validation", textFrom("desktop-status-validation"), textFrom("desktop-status-validation-state"));

  const capabilityMap = [
    ["github", "capabilities-github", "capabilities-github-state"],
    ["ci", "capabilities-ci", "capabilities-ci-state"],
    ["repository", "capabilities-repository", "capabilities-repository-state"],
    ["remote", "capabilities-remote", "capabilities-remote-state"],
    ["monitoring", "capabilities-monitoring", "capabilities-monitoring-state"],
  ];
  for (const [key, valueId, stateId] of capabilityMap) {
    setSettingsValue(`settings-capability-${key}`, textFrom(valueId), textFrom(stateId));
  }

  const session = String(currentSessionId() ?? "—");
  const sessionNode = document.getElementById("settings-current-session");
  const aboutSessionNode = document.getElementById("settings-about-session");
  if (sessionNode) sessionNode.textContent = session;
  if (aboutSessionNode) aboutSessionNode.textContent = session;
}

function applySettingsFilter() {
  const search = document.getElementById("settings-search");
  const query = String(search?.value || "").trim().toLowerCase();
  let matchCount = 0;
  for (const panel of settingsView.querySelectorAll("[data-settings-panel]")) {
    const cards = [...panel.querySelectorAll("[data-settings-card]")];
    const nav = settingsView.querySelector(`[data-settings-section="${CSS.escape(panel.dataset.settingsPanel || "")}"]`);
    const navMatches = !query || String(nav?.textContent || "").toLowerCase().includes(query);
    let cardMatches = 0;
    for (const card of cards) {
      const matches = !query || String(card.textContent || "").toLowerCase().includes(query);
      card.hidden = Boolean(query && !matches && !navMatches);
      if (!card.hidden) cardMatches += 1;
    }
    const shouldShow = query
      ? navMatches || cardMatches > 0
      : panel.dataset.settingsPanel === activeSection;
    panel.hidden = !shouldShow;
    if (shouldShow) matchCount += cardMatches || (navMatches ? 1 : 0);
    if (nav) nav.hidden = Boolean(query && !navMatches && cardMatches === 0);
  }
  const noResults = document.getElementById("settings-no-results");
  if (noResults) noResults.hidden = !query || matchCount > 0;
}

function bindSettingsEvents() {
  document.getElementById("settings-back")?.addEventListener("click", closeSettings);
  document.getElementById("settings-search")?.addEventListener("input", applySettingsFilter);
  for (const button of settingsView.querySelectorAll("[data-settings-section]")) {
    button.addEventListener("click", () => {
      activeSection = button.dataset.settingsSection || "general";
      writeStorage(SETTINGS_STORAGE_KEYS.section, activeSection);
      const search = document.getElementById("settings-search");
      if (search) search.value = "";
      renderSettingsView();
      document.querySelector(`[data-settings-section="${CSS.escape(activeSection)}"]`)?.focus();
    });
  }
  for (const button of settingsView.querySelectorAll("[data-settings-theme]")) {
    button.addEventListener("click", () => {
      const preference = button.dataset.settingsTheme;
      if (!["dark", "light", "system"].includes(preference || "")) return;
      const bridge = mainBridge();
      if (typeof bridge.setThemePreference === "function") bridge.setThemePreference(preference);
      else {
        writeStorage(SETTINGS_STORAGE_KEYS.theme, preference);
        document.documentElement.dataset.theme = preference;
      }
      renderSettingsView();
    });
  }
  for (const button of settingsView.querySelectorAll("[data-settings-language]")) {
    button.addEventListener("click", () => {
      const language = button.dataset.settingsLanguage;
      if (language !== "en" && language !== "zh") return;
      const bridge = mainBridge();
      if (typeof bridge.setLanguagePreference === "function") bridge.setLanguagePreference(language);
      else document.getElementById(language === "zh" ? "language-zh" : "language-en")?.click();
      window.requestAnimationFrame(() => renderSettingsView());
    });
  }
  document.getElementById("settings-composer-mode")?.addEventListener("change", (event) => {
    const mode = event.currentTarget.value === "plan" ? "plan" : "normal";
    const bridge = mainBridge();
    if (typeof bridge.setComposerMode === "function") bridge.setComposerMode(mode);
    else {
      writeStorage(SETTINGS_STORAGE_KEYS.composerMode, mode);
      const select = document.getElementById("composer-mode");
      if (select) select.value = mode;
    }
  });
  document.getElementById("settings-inspector-open")?.addEventListener("change", (event) => {
    const open = Boolean(event.currentTarget.checked);
    const bridge = mainBridge();
    if (typeof bridge.setInspectorOpen === "function") bridge.setInspectorOpen(open);
    else {
      writeStorage(SETTINGS_STORAGE_KEYS.inspectorCollapsed, String(!open));
      const inspector = document.getElementById("runtime-inspector");
      inspector?.classList.toggle("is-open", open);
    }
    const stateNode = document.getElementById("settings-inspector-state");
    if (stateNode) stateNode.textContent = translate(open ? "stateOpen" : "stateClosed");
  });
  document.getElementById("settings-runtime-refresh")?.addEventListener("click", () => {
    const bridge = mainBridge();
    if (typeof bridge.refreshRuntimeStatus === "function") bridge.refreshRuntimeStatus();
    window.setTimeout(refreshRuntimeValues, 120);
  });
}

function openSettings() {
  if (isOpen) return;
  previousFocus = document.activeElement;
  isOpen = true;
  settingsView.hidden = false;
  settingsView.classList.add("is-open");
  document.body.classList.add("settings-open");
  appShell?.setAttribute("aria-hidden", "true");
  if (appShell && "inert" in appShell) appShell.inert = true;
  renderSettingsView();
  window.requestAnimationFrame(() => document.getElementById("settings-search")?.focus());
}

function closeSettings() {
  if (!isOpen) return;
  isOpen = false;
  settingsView.classList.remove("is-open");
  settingsView.hidden = true;
  document.body.classList.remove("settings-open");
  appShell?.removeAttribute("aria-hidden");
  if (appShell && "inert" in appShell) appShell.inert = false;
  if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
  previousFocus = null;
}

settingsTrigger.querySelector(".settings-trigger-label").textContent = translate("trigger");
settingsTrigger.title = translate("triggerTitle");
settingsTrigger.setAttribute("aria-label", translate("triggerTitle"));

const settingsObserver = new MutationObserver((mutations) => {
  const languageChanged = mutations.some((mutation) => mutation.type === "attributes" && mutation.attributeName === "lang");
  const themeChanged = mutations.some((mutation) => mutation.type === "attributes" && mutation.attributeName === "data-theme");
  if (languageChanged || themeChanged) {
    settingsTrigger.querySelector(".settings-trigger-label").textContent = translate("trigger");
    settingsTrigger.title = translate("triggerTitle");
    settingsTrigger.setAttribute("aria-label", translate("triggerTitle"));
    if (isOpen) renderSettingsView();
  } else if (isOpen) {
    refreshRuntimeValues();
  }
});
settingsObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "data-theme"] });

const statusObserver = new MutationObserver(() => {
  if (isOpen) refreshRuntimeValues();
});
for (const id of [
  "desktop-status-panel",
  "workbench-capabilities-panel",
  "conversation-session-id",
  "composer-mode",
]) {
  const node = document.getElementById(id);
  if (node) statusObserver.observe(node, { subtree: true, childList: true, characterData: true, attributes: true });
}

document.addEventListener("keydown", (event) => {
  if (!isOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSettings();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...settingsView.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])")]
    .filter((node) => !node.hidden && node.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

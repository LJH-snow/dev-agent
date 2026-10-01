const STORAGE_KEY = "dev-agent.execution-history-filters.v1";
const MAX_SEARCH_LENGTH = 96;
const DEFAULT_FILTERS = Object.freeze({
  search: "",
  status: "all",
  validation: "all",
  format: "json",
});

export function readExecutionHistoryFilters(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return { ...DEFAULT_FILTERS };
    return normalizeExecutionHistoryFilters(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

export function writeExecutionHistoryFilters(storage, value) {
  const normalized = normalizeExecutionHistoryFilters(value);
  try {
    const serialized = JSON.stringify(normalized);
    if (serialized.length > 2048 || typeof storage?.setItem !== "function") return false;
    storage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function normalizeExecutionHistoryFilters(value) {
  if (!isRecord(value)) return { ...DEFAULT_FILTERS };
  if (value.search !== undefined && (typeof value.search !== "string" || value.search.trim().length > MAX_SEARCH_LENGTH)) {
    return { ...DEFAULT_FILTERS };
  }
  const search = typeof value.search === "string" ? value.search.trim() : "";
  const status = ["all", "done", "failed", "aborted"].includes(value.status) ? value.status : "all";
  const validation = ["all", "passed", "failed", "skipped", "blocked", "none"].includes(value.validation)
    ? value.validation
    : "all";
  const format = value.format === "markdown" ? "markdown" : "json";
  return { search, status, validation, format };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

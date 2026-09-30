import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface SkillMarketplaceEntry {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly source: string;
  readonly permissions: readonly string[];
  readonly installedVersion?: string;
  readonly disabled?: boolean;
}
interface Catalog { readonly entries?: readonly unknown[] }
interface State { readonly installed?: Record<string, string>; readonly disabled?: readonly string[] }
export interface SkillMarketplaceOptions { readonly workingDirectory: string; readonly catalogPath?: string; readonly statePath?: string }

export class LocalSkillMarketplace {
  private readonly root: string;
  private readonly catalogPath: string;
  private readonly statePath: string;
  constructor(options: SkillMarketplaceOptions) {
    this.root = resolve(options.workingDirectory);
    this.catalogPath = resolve(options.catalogPath ?? join(this.root, ".dev-agent", "skill-marketplace.json"));
    this.statePath = resolve(options.statePath ?? join(this.root, ".dev-agent", "skill-marketplace-state.json"));
  }
  async list(): Promise<readonly SkillMarketplaceEntry[]> {
    const catalog = await this.readCatalog();
    const state = await this.readState();
    return catalog.map((entry) => ({ ...entry, ...(state.installed?.[entry.name] === undefined ? {} : { installedVersion: state.installed[entry.name] }), disabled: state.disabled?.includes(entry.name) === true }));
  }
  async search(query: string): Promise<readonly SkillMarketplaceEntry[]> {
    const needle = query.trim().toLowerCase();
    return (await this.list()).filter((entry) => !needle || `${entry.name} ${entry.description}`.toLowerCase().includes(needle));
  }
  async install(name: string, confirm: (prompt: string) => Promise<boolean>): Promise<boolean> {
    const entry = (await this.list()).find((item) => item.name === name);
    if (!entry || entry.disabled || entry.installedVersion === entry.version) return false;
    if (!await confirm(`Install skill ${entry.name}@${entry.version} with permissions [${entry.permissions.join(", ") || "none"}]?`)) return false;
    const source = await this.safeSource(entry.source);
    if (!source) return false;
    const content = await readFile(source, "utf8");
    if (Buffer.byteLength(content, "utf8") > 128 * 1024) return false;
    const targetDirectory = join(this.root, ".dev-agent", "skills", entry.name);
    await mkdir(targetDirectory, { recursive: true });
    await atomicWrite(join(targetDirectory, "SKILL.md"), content);
    const state = await this.readState();
    await this.writeState({ ...state, installed: { ...(state.installed ?? {}), [name]: entry.version }, disabled: (state.disabled ?? []).filter((value) => value !== name) });
    return true;
  }
  async disable(name: string, confirm: (prompt: string) => Promise<boolean>): Promise<boolean> {
    const entry = (await this.list()).find((item) => item.name === name);
    if (!entry || entry.installedVersion === undefined || entry.disabled) return false;
    if (!await confirm(`Disable installed skill ${name}?`)) return false;
    const target = join(this.root, ".dev-agent", "skills", name, "SKILL.md");
    await rename(target, `${target}.disabled`);
    const state = await this.readState();
    await this.writeState({ ...state, disabled: [...new Set([...(state.disabled ?? []), name])] });
    return true;
  }
  async enable(name: string): Promise<boolean> {
    const entry = (await this.list()).find((item) => item.name === name);
    if (!entry?.disabled) return false;
    const target = join(this.root, ".dev-agent", "skills", name, "SKILL.md");
    await rename(`${target}.disabled`, target);
    const state = await this.readState();
    await this.writeState({ ...state, disabled: (state.disabled ?? []).filter((value) => value !== name) });
    return true;
  }
  async format(command: string, confirm: (prompt: string) => Promise<boolean>): Promise<string | undefined> {
    const normalized = command.trim().replace(/^\//u, ":");
    if (normalized === ":marketplace" || normalized === ":marketplace list") return this.render(await this.list(), "Skill Marketplace");
    if (normalized.startsWith(":marketplace search ")) return this.render(await this.search(normalized.slice(20).trim()), "Skill Marketplace search");
    if (normalized.startsWith(":marketplace install ")) return `Skill install ${await this.install(normalized.slice(21).trim(), confirm) ? "completed" : "not applied"}. Restart the CLI to refresh skill discovery.`;
    if (normalized.startsWith(":marketplace disable ")) return `Skill disable ${await this.disable(normalized.slice(21).trim(), confirm) ? "completed" : "not applied"}. Restart the CLI to refresh skill discovery.`;
    if (normalized.startsWith(":marketplace enable ")) return `Skill enable ${await this.enable(normalized.slice(20).trim()) ? "completed" : "not applied"}. Restart the CLI to refresh skill discovery.`;
    if (normalized.startsWith(":marketplace")) return "Usage: :marketplace [list|search <term>|install <name>|disable <name>|enable <name>].";
    return undefined;
  }
  private async readCatalog(): Promise<SkillMarketplaceEntry[]> {
    try { const parsed = JSON.parse(await readFile(this.catalogPath, "utf8")) as Catalog; if (!Array.isArray(parsed.entries)) return []; return parsed.entries.flatMap((value) => normalizeEntry(value)); } catch { return []; }
  }
  private async readState(): Promise<State> { try { const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as State; return { installed: isRecord(parsed.installed) ? Object.fromEntries(Object.entries(parsed.installed).filter(([, value]) => typeof value === "string")) : {}, disabled: Array.isArray(parsed.disabled) ? parsed.disabled.filter((value): value is string => typeof value === "string") : [] }; } catch { return {}; } }
  private async writeState(state: State): Promise<void> { await atomicWrite(this.statePath, JSON.stringify(state)); }
  private async safeSource(sourceValue: string): Promise<string | undefined> { if (/^[a-z]+:\/\//iu.test(sourceValue)) return undefined; const source = resolve(dirname(this.catalogPath), sourceValue); const allowedRoot = resolve(dirname(this.catalogPath)); const relativeSource = relative(allowedRoot, source); if (relativeSource === ".." || relativeSource.startsWith(`..${sep}`) || isAbsolute(relativeSource)) return undefined; return source; }
  private render(entries: readonly SkillMarketplaceEntry[], title: string): string { return entries.length === 0 ? `${title}: no skills found.` : [title+":", ...entries.map((entry) => `- ${entry.name}@${entry.version} · ${entry.description} · permissions=${entry.permissions.join(",") || "none"}${entry.installedVersion ? ` · installed=${entry.installedVersion}${entry.disabled ? " (disabled)" : ""}` : ""}`)].join("\n"); }
}

function normalizeEntry(value: unknown): SkillMarketplaceEntry[] { if (!isRecord(value) || typeof value.name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/iu.test(value.name) || typeof value.version !== "string" || typeof value.description !== "string" || typeof value.source !== "string" || !Array.isArray(value.permissions) || value.permissions.some((item) => typeof item !== "string" || item.length > 64)) return []; return [{ name: value.name, version: value.version, description: value.description.slice(0, 240), source: value.source, permissions: value.permissions.slice(0, 32) }]; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function atomicWrite(path: string, content: string): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp-${process.pid}-${Date.now()}`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await rename(temporary, path); }

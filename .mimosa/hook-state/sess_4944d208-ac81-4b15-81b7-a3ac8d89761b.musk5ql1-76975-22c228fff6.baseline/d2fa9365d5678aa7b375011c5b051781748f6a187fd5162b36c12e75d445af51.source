import type { CodeSymbol, SymbolKind } from "./index.js";

/**
 * Visibility and item modifiers that may precede a Rust declaration.
 * `pub`, `pub(crate)`, `async`, `unsafe`, `const`, `default`, and
 * `extern "C"` can all appear (in any order) before `fn`/`struct`/`impl`.
 */
const MODIFIER_PATTERN =
  /^(?:pub(?:\s*\([^)]*\))?|async|unsafe|const|default|extern(?:\s+"[^"]*")?)\s+/;

export function scanRustSymbols(source: string, filePath: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = source.split("\n");
  let depth = 0;
  let container: { readonly name: string; readonly depth: number } | undefined;
  let pendingContainer: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;

    const trimmed = rawLine.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }

    const declaration = stripModifiers(trimmed);
    const traitMatch = /^trait\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(declaration);
    const implMatch = /^impl\b/.test(declaration);
    const fnMatch = /^fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*[<(]/.exec(declaration);

    if (traitMatch?.[1]) {
      symbols.push(makeSymbol("interface", traitMatch[1], filePath, i + 1, undefined, trimmed));
      pendingContainer = traitMatch[1];
    } else if (implMatch) {
      const name = implTypeName(declaration);
      if (name) {
        pendingContainer = name;
      }
    } else if (fnMatch?.[1]) {
      symbols.push(
        makeSymbol(
          container ? "method" : "function",
          fnMatch[1],
          filePath,
          i + 1,
          container?.name,
          trimmed
        )
      );
    } else if (declaration.startsWith("struct ")) {
      const name = declarationName(declaration, "struct");
      if (name) {
        symbols.push(makeSymbol("class", name, filePath, i + 1, undefined, trimmed));
      }
    } else if (declaration.startsWith("enum ")) {
      const name = declarationName(declaration, "enum");
      if (name) {
        symbols.push(makeSymbol("enum", name, filePath, i + 1, undefined, trimmed));
      }
    } else if (declaration.startsWith("type ")) {
      const name = declarationName(declaration, "type");
      if (name) {
        symbols.push(makeSymbol("type", name, filePath, i + 1, undefined, trimmed));
      }
    } else if (declaration.startsWith("mod ")) {
      const name = declarationName(declaration, "mod");
      if (name) {
        symbols.push(makeSymbol("variable", name, filePath, i + 1, undefined, trimmed));
      }
    } else {
      const useMatch = /^use\s+([A-Za-z_][A-Za-z0-9_:]+)/.exec(declaration);
      if (useMatch?.[1]) {
        const parts = useMatch[1].split("::");
        const name = parts[parts.length - 1];
        if (name) {
          symbols.push(makeSymbol("variable", name, filePath, i + 1, undefined, trimmed));
        }
      }
    }

    const opens = countChar(trimmed, "{");
    const closes = countChar(trimmed, "}");
    depth = Math.max(0, depth + opens - closes);

    if (pendingContainer !== undefined) {
      // A one-line block (`impl Foo { fn x() {} }`) should not make the lines
      // that follow it part of the container.
      container = opens > closes ? { name: pendingContainer, depth } : undefined;
      pendingContainer = undefined;
    }
    if (container && depth < container.depth) {
      container = undefined;
    }
  }

  return symbols;
}

/** Removes any number of leading visibility/item modifiers. */
function stripModifiers(declaration: string): string {
  let text = declaration;
  while (MODIFIER_PATTERN.test(text)) {
    text = text.replace(MODIFIER_PATTERN, "");
  }
  return text;
}

function declarationName(declaration: string, keyword: string): string | undefined {
  const match = new RegExp(`^${keyword}\\s+([A-Za-z_][A-Za-z0-9_]*)`).exec(declaration);
  return match?.[1];
}

/**
 * The type an `impl` block is for: `impl Foo`, `impl<T> Foo<T>`, and
 * `impl Trait for Foo` all yield `Foo`.
 */
function implTypeName(declaration: string): string | undefined {
  const text = declaration
    .replace(/^impl\b/, "")
    .replace(/^\s*<[^>]*>/, "")
    .trim();
  const forIndex = text.search(/\bfor\b/);
  const target = forIndex >= 0 ? text.slice(forIndex + 3) : text;
  const head = target.split(/\bwhere\b|\{/)[0] ?? "";
  const withoutGenerics = head.replace(/<.*$/, "").trim();
  const name = withoutGenerics.split("::").pop()?.trim();
  return name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : undefined;
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const value of text) {
    if (value === char) {
      count += 1;
    }
  }
  return count;
}

function makeSymbol(
  kind: SymbolKind,
  name: string,
  filePath: string,
  line: number,
  containerName?: string,
  signature?: string
): CodeSymbol {
  return { name, kind, filePath, line, containerName, signature };
}

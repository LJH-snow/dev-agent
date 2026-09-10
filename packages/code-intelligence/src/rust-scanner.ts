import type { CodeSymbol, SymbolKind } from "./index.js";

export function scanRustSymbols(source: string, filePath: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;

    const trimmed = rawLine.trim();

    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }

    const fnMatch = /^fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*[<(]/.exec(trimmed);
    if (fnMatch && fnMatch[1]) {
      symbols.push(makeSymbol("function", fnMatch[1], filePath, i + 1));
      continue;
    }

    const structMatch = /^struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*[<{]?\s*$/.exec(trimmed);
    if (structMatch && structMatch[1]) {
      symbols.push(makeSymbol("class", structMatch[1], filePath, i + 1));
      continue;
    }

    const enumMatch = /^enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*[<{]?\s*$/.exec(trimmed);
    if (enumMatch && enumMatch[1]) {
      symbols.push(makeSymbol("enum", enumMatch[1], filePath, i + 1));
      continue;
    }

    const typeMatch = /^type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(trimmed);
    if (typeMatch && typeMatch[1]) {
      symbols.push(makeSymbol("type", typeMatch[1], filePath, i + 1));
      continue;
    }

    const modMatch = /^mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*[;{]/.exec(trimmed);
    if (modMatch && modMatch[1]) {
      symbols.push(makeSymbol("variable", modMatch[1], filePath, i + 1));
      continue;
    }

    const useMatch = /^use\s+([A-Za-z_][A-Za-z0-9_:]+)/.exec(trimmed);
    if (useMatch && useMatch[1]) {
      const parts = useMatch[1].split("::");
      const name = parts[parts.length - 1];
      if (name) {
        symbols.push(makeSymbol("variable", name, filePath, i + 1));
      }
      continue;
    }
  }

  return symbols;
}

function makeSymbol(
  kind: SymbolKind,
  name: string,
  filePath: string,
  line: number,
  containerName?: string
): CodeSymbol {
  return { name, kind, filePath, line, containerName };
}

import type { CodeSymbol, SymbolKind } from "./index.js";

export function scanPythonSymbols(source: string, filePath: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = source.split("\n");
  let currentClass: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;

    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    if (indent === 0) {
      currentClass = undefined;
    }

    const classMatch = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:(]/.exec(trimmed);
    if (classMatch && classMatch[1]) {
      const name = classMatch[1];
      currentClass = name;
      symbols.push(makeSymbol("class", name, filePath, i + 1));
      continue;
    }

    const funcMatch = /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(trimmed);
    if (funcMatch && funcMatch[1]) {
      const name = funcMatch[1];
      const kind: SymbolKind = currentClass !== undefined && indent > 0 ? "method" : "function";
      symbols.push(makeSymbol(kind, name, filePath, i + 1, currentClass));
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

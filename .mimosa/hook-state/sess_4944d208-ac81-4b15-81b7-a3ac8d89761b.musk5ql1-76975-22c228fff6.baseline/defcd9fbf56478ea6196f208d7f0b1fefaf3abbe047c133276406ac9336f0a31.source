import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

import type { CodeSymbol, SymbolKind } from "./index.js";

export interface ReferenceSite {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly isWriteAccess: boolean;
  readonly snippet: string;
}

export interface ReferenceIndexOptions {
  readonly files: ReadonlyMap<string, string>;
  readonly compilerOptions?: ts.CompilerOptions;
  readonly libDir?: string;
}

export class TypeScriptReferenceIndex {
  private readonly service: ts.LanguageService;
  private readonly files = new Map<string, string>();
  private readonly libDir: string;

  constructor(options: ReferenceIndexOptions) {
    options.files.forEach((value, key) => this.files.set(key, value));
    this.libDir = options.libDir ?? defaultLibDir();
    const compilerOptions = options.compilerOptions ?? defaultCompilerOptions();
    const host = this.createHost(compilerOptions);
    this.service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  findReferences(filePath: string, line: number, column: number = 1): ReferenceSite[] {
    const program = this.program();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      return [];
    }

    const position = ts.getPositionOfLineAndCharacter(sourceFile, line - 1, column - 1);
    const references = this.service.getReferencesAtPosition(filePath, position);
    if (!references) {
      return [];
    }

    return references.map((entry) => this.toReferenceSite(program, entry));
  }

  findDefinition(
    filePath: string,
    line: number,
    column: number = 1
  ): CodeSymbol | undefined {
    const program = this.program();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      return undefined;
    }

    const position = ts.getPositionOfLineAndCharacter(sourceFile, line - 1, column - 1);
    const definitions = this.service.getDefinitionAtPosition(filePath, position);
    const first = definitions?.[0];
    if (!first) {
      return undefined;
    }

    return this.toCodeSymbol(program, first);
  }

  private program(): ts.Program {
    const program = this.service.getProgram();
    if (!program) {
      throw new Error("TypeScript program is not available");
    }
    return program;
  }

  private createHost(compilerOptions: ts.CompilerOptions): ts.LanguageServiceHost {
    const files = this.files;
    const libDir = this.libDir;

    const readFile = (fileName: string): string | undefined => {
      const virtual = files.get(fileName);
      if (virtual !== undefined) {
        return virtual;
      }
      if (fileName.startsWith(libDir)) {
        return ts.sys.readFile(fileName);
      }
      return undefined;
    };
    const fileExists = (fileName: string): boolean => {
      if (files.has(fileName)) {
        return true;
      }
      if (fileName.startsWith(libDir)) {
        return ts.sys.fileExists(fileName);
      }
      return false;
    };

    return {
      getCompilationSettings: () => compilerOptions,
      getScriptFileNames: () => [...files.keys()],
      getScriptVersion: () => "1",
      getScriptSnapshot: (fileName) => {
        const text = readFile(fileName);
        return text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined;
      },
      getCurrentDirectory: () => "/",
      getDefaultLibFileName: () =>
        path.join(libDir, ts.getDefaultLibFileName(compilerOptions)),
      fileExists,
      readFile,
      readDirectory: ts.sys.readDirectory,
    };
  }

  private toReferenceSite(program: ts.Program, entry: ts.ReferenceEntry): ReferenceSite {
    const sourceFile = program.getSourceFile(entry.fileName);
    if (!sourceFile) {
      return {
        filePath: entry.fileName,
        line: 0,
        column: 0,
        isWriteAccess: entry.isWriteAccess,
        snippet: "",
      };
    }

    const start = entry.textSpan.start;
    const location = ts.getLineAndCharacterOfPosition(sourceFile, start);
    return {
      filePath: entry.fileName,
      line: location.line + 1,
      column: location.character + 1,
      isWriteAccess: entry.isWriteAccess,
      snippet: readLine(sourceFile.text, start),
    };
  }

  private toCodeSymbol(program: ts.Program, definition: ts.DefinitionInfo): CodeSymbol {
    const sourceFile = program.getSourceFile(definition.fileName);
    const start = definition.textSpan.start;
    const location = sourceFile
      ? ts.getLineAndCharacterOfPosition(sourceFile, start)
      : { line: 0, character: 0 };
    return {
      name: definition.name,
      kind: mapKind(definition.kind),
      filePath: definition.fileName,
      line: location.line + 1,
      column: location.character + 1,
      containerName: definition.containerName,
      signature: sourceFile ? readLine(sourceFile.text, start) : "",
    };
  }
}

function defaultCompilerOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    resolveJsonModule: true,
    allowJs: true,
    strict: false,
    skipLibCheck: true,
    lib: ["lib.es2022.d.ts"],
  };
}

function defaultLibDir(): string {
  const require = createRequire(import.meta.url);
  return path.dirname(require.resolve("typescript"));
}

function mapKind(kind: string): SymbolKind {
  switch (kind) {
    case "function":
      return "function";
    case "method":
      return "method";
    case "class":
      return "class";
    case "interface":
      return "interface";
    case "type":
    case "alias":
      return "type";
    case "enum":
      return "enum";
    case "property":
    case "getter":
    case "setter":
    case "member":
      return "property";
    default:
      return "variable";
  }
}

function readLine(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = source.indexOf("\n", offset);
  const end = lineEnd === -1 ? source.length : lineEnd;
  const text = source.slice(lineStart, end).trim().replace(/\s+/g, " ");
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

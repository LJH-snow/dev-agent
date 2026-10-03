import ts from "typescript";

import type { CodeSymbol, SymbolKind } from "./index.js";

export interface SourceScanner {
  scan(source: string, filePath: string): CodeSymbol[];
}

export const typeScriptScanner: SourceScanner = {
  scan(source, filePath) {
    return scanTypeScriptSymbols(source, filePath);
  },
};

export function scanTypeScriptSymbols(source: string, filePath: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    detectScriptKind(filePath)
  );
  const containerStack: string[] = [];

  function addSymbol(kind: SymbolKind, name: string, node: ts.Node): void {
    if (!name || name === "default") {
      return;
    }

    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    symbols.push({
      name,
      kind,
      filePath,
      line: position.line + 1,
      column: position.character + 1,
      containerName: containerStack.at(-1),
      signature: readSignature(sourceFile, node),
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node)) {
      if (node.name) {
        addSymbol("function", node.name.text, node);
      }
      visitChildren(node);
      return;
    }

    if (ts.isClassDeclaration(node)) {
      if (node.name) {
        addSymbol("class", node.name.text, node);
        containerStack.push(node.name.text);
        visitChildren(node);
        containerStack.pop();
      } else {
        visitChildren(node);
      }
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      if (node.name) {
        addSymbol("interface", node.name.text, node);
        containerStack.push(node.name.text);
        visitChildren(node);
        containerStack.pop();
      } else {
        visitChildren(node);
      }
      return;
    }

    if (ts.isTypeAliasDeclaration(node)) {
      if (node.name) {
        addSymbol("type", node.name.text, node);
      }
      return;
    }

    if (ts.isEnumDeclaration(node)) {
      if (node.name) {
        addSymbol("enum", node.name.text, node);
        containerStack.push(node.name.text);
        visitChildren(node);
        containerStack.pop();
      }
      return;
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }

        const initializer = declaration.initializer;
        const isFunctionValue =
          initializer !== undefined &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
        addSymbol(isFunctionValue ? "function" : "variable", declaration.name.text, declaration);
      }
      return;
    }

    if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
      if (node.name && ts.isIdentifier(node.name)) {
        addSymbol("method", node.name.text, node);
      }
      return;
    }

    if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
      if (node.name && ts.isIdentifier(node.name)) {
        addSymbol("property", node.name.text, node);
      }
      return;
    }

    if (ts.isModuleDeclaration(node)) {
      if (node.name && ts.isIdentifier(node.name)) {
        containerStack.push(node.name.text);
        visitChildren(node);
        containerStack.pop();
      } else {
        visitChildren(node);
      }
      return;
    }

    visitChildren(node);
  }

  function visitChildren(node: ts.Node): void {
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return symbols;
}

function detectScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".mtsx")) {
    return ts.ScriptKind.TSX;
  }
  if (filePath.endsWith(".jsx") || filePath.endsWith(".mjsx") || filePath.endsWith(".cjsx")) {
    return ts.ScriptKind.JSX;
  }
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function readSignature(sourceFile: ts.SourceFile, node: ts.Node): string {
  const start = node.getStart(sourceFile);
  const newline = sourceFile.text.indexOf("\n", start);
  const end = newline === -1 ? node.end : Math.min(node.end, newline);
  const text = sourceFile.text.slice(start, end).trim().replace(/\s+/g, " ");
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

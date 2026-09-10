import assert from "node:assert/strict";
import test from "node:test";

import { scanPythonSymbols } from "../dist/python-scanner.js";

test("python scanner detects top-level functions", () => {
  const source = `
def hello():
    pass

def world():
    return 42
`;
  const symbols = scanPythonSymbols(source, "test.py");
  const funcs = symbols.filter((s) => s.name === "hello" || s.name === "world");
  assert.equal(funcs.length, 2);
  assert.equal(funcs[0].kind, "function");
  assert.equal(funcs[0].filePath, "test.py");
});

test("python scanner detects classes and methods", () => {
  const source = `
class MyClass:
    def method_one(self):
        pass
    
    def method_two(self, x):
        return x
`;
  const symbols = scanPythonSymbols(source, "models.py");
  const cls = symbols.find((s) => s.name === "MyClass");
  assert.ok(cls);
  assert.equal(cls.kind, "class");

  const methods = symbols.filter((s) => s.kind === "method");
  assert.equal(methods.length, 2);
  assert.equal(methods[0].containerName, "MyClass");
});

test("python scanner handles empty files", () => {
  const symbols = scanPythonSymbols("", "empty.py");
  assert.equal(symbols.length, 0);
});

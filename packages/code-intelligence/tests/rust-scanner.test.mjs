import assert from "node:assert/strict";
import test from "node:test";

import { scanRustSymbols } from "../dist/rust-scanner.js";

test("rust scanner detects functions", () => {
  const source = `
fn main() {
    println!("Hello");
}

fn add(a: i32, b: i32) -> i32 {
    a + b
}
`;
  const symbols = scanRustSymbols(source, "main.rs");
  const funcs = symbols.filter((s) => s.kind === "function");
  assert.ok(funcs.length >= 2);
  assert.ok(funcs.some((f) => f.name === "main"));
  assert.ok(funcs.some((f) => f.name === "add"));
});

test("rust scanner detects structs and enums", () => {
  const source = `
struct Point {
    x: f64,
    y: f64,
}

enum Direction {
    Up,
    Down,
    Left,
    Right,
}
`;
  const symbols = scanRustSymbols(source, "types.rs");
  const structs = symbols.filter((s) => s.name === "Point");
  const enums = symbols.filter((s) => s.name === "Direction");
  assert.equal(structs.length, 1);
  assert.equal(structs[0].kind, "class");
  assert.equal(enums.length, 1);
  assert.equal(enums[0].kind, "enum");
});

test("rust scanner skips comments", () => {
  const source = `
// fn commented_out()
/* struct AlsoCommented */
fn real_function() {}
`;
  const symbols = scanRustSymbols(source, "comments.rs");
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].name, "real_function");
});

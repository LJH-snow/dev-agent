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

test("rust scanner detects public and modified declarations", () => {
  const source = `
pub fn exported() {}
pub(crate) async fn fetch() {}
pub unsafe fn risky() {}
pub const fn constant() {}
extern "C" fn ffi_entry() {}
pub struct Config {}
pub enum Mode { Fast }
pub type Result = i32;
pub mod inner;
pub use crate::inner::Thing;
`;
  const symbols = scanRustSymbols(source, "public.rs");
  const names = symbols.map((symbol) => symbol.name);

  for (const expected of [
    "exported",
    "fetch",
    "risky",
    "constant",
    "ffi_entry",
    "Config",
    "Mode",
    "Result",
    "inner",
    "Thing",
  ]) {
    assert.ok(names.includes(expected), `expected ${expected} in ${names.join(", ")}`);
  }
  assert.equal(symbols.find((symbol) => symbol.name === "Config").kind, "class");
});

test("rust scanner marks impl methods with their container", () => {
  const source = `
impl Widget {
    pub fn build(&self) {}
    fn hidden(&self) {}
}

fn free_function() {}
`;
  const symbols = scanRustSymbols(source, "widget.rs");
  const build = symbols.find((symbol) => symbol.name === "build");
  const hidden = symbols.find((symbol) => symbol.name === "hidden");
  const free = symbols.find((symbol) => symbol.name === "free_function");

  assert.equal(build?.kind, "method");
  assert.equal(build?.containerName, "Widget");
  assert.equal(hidden?.kind, "method");
  assert.equal(hidden?.containerName, "Widget");
  assert.equal(free?.kind, "function");
  assert.equal(free?.containerName, undefined);
});

test("rust scanner detects traits and their methods", () => {
  const source = `
pub trait Render {
    fn render(&self);
}

impl Render for Widget {
    fn render(&self) {}
}
`;
  const symbols = scanRustSymbols(source, "trait.rs");
  const trait = symbols.find((symbol) => symbol.name === "Render" && symbol.kind === "interface");
  const methods = symbols.filter((symbol) => symbol.name === "render");

  assert.ok(trait, "the trait should be an interface symbol");
  assert.equal(methods.length, 2);
  for (const method of methods) {
    assert.equal(method.kind, "method");
  }
  assert.deepEqual(
    methods.map((method) => method.containerName).sort(),
    ["Render", "Widget"]
  );
});

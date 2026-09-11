import assert from "node:assert/strict";
import test from "node:test";

import { estimateCost } from "../dist/index.js";

const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };

test("estimateCost prices a known model", () => {
  const cost = estimateCost(usage, "gpt-4o-mini", {
    "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  });

  assert.equal(cost, 0.00045);
});

test("estimateCost returns undefined for an unknown model", () => {
  const cost = estimateCost(usage, "qwen3:4b-instruct", {
    "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  });

  assert.equal(cost, undefined);
});

test("estimateCost prefers the longest matching model prefix", () => {
  const cost = estimateCost(usage, "gpt-4o-mini-2024-07-18", {
    "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
    "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  });

  assert.equal(cost, 0.00045);
});

test("estimateCost ignores malformed price entries", () => {
  const prices = {
    "gpt-4o-mini": { inputPerMillion: "free" },
  };

  assert.equal(estimateCost(usage, "gpt-4o-mini", prices), undefined);
});

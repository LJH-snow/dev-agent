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

test("estimateCost charges cached tokens at the cache price", () => {
  const cost = estimateCost(
    { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, cachedPromptTokens: 400 },
    "gpt-4o-mini",
    {
      "gpt-4o-mini": {
        inputPerMillion: 1,
        outputPerMillion: 2,
        cachedInputPerMillion: 0.25,
      },
    }
  );

  // 600 * 1 + 400 * 0.25 + 500 * 2 = 1700 per million
  assert.equal(cost, 0.0017);
});

test("estimateCost falls back to the input price without a cache price", () => {
  const cost = estimateCost(
    { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, cachedPromptTokens: 400 },
    "gpt-4o-mini",
    { "gpt-4o-mini": { inputPerMillion: 1, outputPerMillion: 2 } }
  );

  assert.equal(cost, 0.002);
});

test("estimateCost clamps cached tokens to the prompt total", () => {
  const cost = estimateCost(
    { promptTokens: 100, completionTokens: 0, totalTokens: 100, cachedPromptTokens: 500 },
    "gpt-4o-mini",
    {
      "gpt-4o-mini": {
        inputPerMillion: 1,
        outputPerMillion: 2,
        cachedInputPerMillion: 0,
      },
    }
  );

  assert.equal(cost, 0);
});

test("estimateCost charges cache writes at the creation price", () => {
  const cost = estimateCost(
    {
      promptTokens: 1000,
      completionTokens: 0,
      totalTokens: 1000,
      cachedPromptTokens: 300,
      cacheCreationPromptTokens: 100,
    },
    "claude-sonnet-4",
    {
      "claude-sonnet-4": {
        inputPerMillion: 1,
        outputPerMillion: 2,
        cachedInputPerMillion: 0.25,
        cacheCreationInputPerMillion: 1.25,
      },
    }
  );

  // 600 * 1 + 300 * 0.25 + 100 * 1.25 = 800 per million
  assert.equal(cost, 0.0008);
});

test("estimateCost falls back to the input price for cache writes", () => {
  const cost = estimateCost(
    {
      promptTokens: 1000,
      completionTokens: 0,
      totalTokens: 1000,
      cachedPromptTokens: 300,
      cacheCreationPromptTokens: 100,
    },
    "claude-sonnet-4",
    {
      "claude-sonnet-4": {
        inputPerMillion: 1,
        outputPerMillion: 2,
        cachedInputPerMillion: 0.25,
      },
    }
  );

  // 600 * 1 + 300 * 0.25 + 100 * 1 = 775 per million
  assert.equal(cost, 0.000775);
});

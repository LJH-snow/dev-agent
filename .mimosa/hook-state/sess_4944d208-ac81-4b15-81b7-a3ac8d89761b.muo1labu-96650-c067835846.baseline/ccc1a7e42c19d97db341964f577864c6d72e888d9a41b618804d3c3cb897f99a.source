import assert from "node:assert/strict";
import test from "node:test";

import {
  createApprovalPolicy,
  type ApprovalOutcome,
  type ApprovalRequest,
  type ChangeSetReview,
} from "../dist/index.js";

function request(
  toolName = "shell",
  input: unknown = { command: "rm", args: ["-rf", "tmp"] },
  metadata?: ApprovalRequest["metadata"],
): ApprovalRequest {
  return {
    toolName,
    input,
    sessionId: "factory-test",
    workingDirectory: process.cwd(),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function outcome(value: ApprovalOutcome | "allow" | "deny"): ApprovalOutcome {
  return typeof value === "string" ? { decision: value } : value;
}

test("approval policy factory keeps allow mode policy-free", () => {
  assert.equal(createApprovalPolicy({ mode: "allow" }), undefined);
});

test("approval policy factory shares deny-dangerous behavior", async () => {
  const policy = createApprovalPolicy({ mode: "deny-dangerous" });
  const result = outcome(await policy!.decide(request()));

  assert.equal(result.decision, "deny");
  assert.match(result.reason ?? "", /recursive delete/);
});

test("deny-dangerous fails closed for unclassified external tools but permits declared readers", async () => {
  const policy = createApprovalPolicy({ mode: "deny-dangerous" });
  const unclassified = outcome(await policy!.decide(request("remote:unknown", {})));
  const readOnly = outcome(await policy!.decide(request("remote:read", {}, {
    risk: "read-only",
    confirmation: "never",
  })));

  assert.equal(unclassified.decision, "deny");
  assert.match(unclassified.reason ?? "", /unclassified tools/);
  assert.deepEqual(readOnly, { decision: "allow" });
});

test("ask mode sends explicitly dangerous external tools to the interactive requester", async () => {
  const calls: string[] = [];
  const policy = createApprovalPolicy({
    mode: "ask",
    requestApproval: async (approvalRequest, reason) => {
      calls.push(`${approvalRequest.toolName}:${reason ?? ""}`);
      return "allow" as const;
    },
  });
  const result = outcome(await policy!.decide(request("remote:publish", { target: "prod" }, {
    risk: "dangerous",
    confirmation: "always",
  })));

  assert.deepEqual(result, { decision: "allow" });
  assert.deepEqual(calls, ["remote:publish:tool risk is classified as dangerous"]);
});

test("ask mode fails closed for generic mutators without an interactive requester", async () => {
  const policy = createApprovalPolicy({ mode: "ask" });
  const result = outcome(await policy!.decide(request("remote:update", {}, {
    risk: "mutating",
    confirmation: "on-risk",
  })));

  assert.equal(result.decision, "deny");
  assert.match(result.reason ?? "", /interactive approval/);
});

test("ask mode falls back to deny-dangerous without a requester", async () => {
  const policy = createApprovalPolicy({ mode: "ask" });
  const result = outcome(await policy!.decide(request()));

  assert.equal(result.decision, "deny");
  assert.match(result.reason ?? "", /recursive delete/);
});

test("ask mode delegates only denied calls to the requester", async () => {
  const calls: string[] = [];
  const policy = createApprovalPolicy({
    mode: "ask",
    requestApproval: async (approvalRequest, reason) => {
      calls.push(`${approvalRequest.toolName}:${reason ?? ""}`);
      return "allow" as const;
    },
  });

  const outcome = await policy?.decide(request());

  assert.deepEqual(outcome, { decision: "allow" });
  assert.deepEqual(calls, ["shell:recursive delete: rm -rf tmp"]);
});

test("review-writes uses the shared preparation and requester adapters", async () => {
  const review: ChangeSetReview = {
    changeSetId: "change-set-1",
    files: [],
    additions: 0,
    deletions: 0,
    createdAt: new Date(0).toISOString(),
  };
  const policy = createApprovalPolicy({
    mode: "review-writes",
    prepare: () => ({
      review,
      executeInput: { action: "apply", changeSetId: review.changeSetId },
    }),
    requestApproval: () => "allow",
  });

  const preparation = await policy?.prepare?.(
    request("filesystem", { action: "write", path: "file.txt", content: "ok" })
  );
  assert.deepEqual(preparation, {
    review,
    executeInput: { action: "apply", changeSetId: review.changeSetId },
  });

  const outcome = await policy?.decide({
    ...request("filesystem", { action: "write", path: "file.txt", content: "ok" }),
    review,
  });
  assert.deepEqual(outcome, { decision: "allow" });
});

test("review-writes asks before generic external mutations and fails closed without a requester", async () => {
  const externalRequest = request("remote:update", { value: 2 }, {
    risk: "mutating",
    confirmation: "on-risk",
  });
  const calls: string[] = [];
  const interactive = createApprovalPolicy({
    mode: "review-writes",
    requestApproval: async (approvalRequest, reason) => {
      calls.push(`${approvalRequest.toolName}:${reason ?? ""}`);
      return "allow" as const;
    },
  });
  const nonInteractive = createApprovalPolicy({ mode: "review-writes" });

  assert.deepEqual(await interactive!.decide(externalRequest), { decision: "allow" });
  assert.deepEqual(calls, ["remote:update:mutating tool calls require interactive approval"]);
  const denied = outcome(await nonInteractive!.decide(externalRequest));
  assert.equal(denied.decision, "deny");
  assert.match(denied.reason ?? "", /interactive approval/);
});

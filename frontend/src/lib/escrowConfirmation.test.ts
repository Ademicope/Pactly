import assert from "node:assert/strict";
import { test } from "node:test";

import { describeEscrowConfirmation, ESCROW_UNAVAILABLE_CODE } from "./escrowConfirmation.js";

const FIXTURE_CONTRACT_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

test("describeEscrowConfirmation shows the fixture contract id when the server returned one", () => {
  assert.deepEqual(describeEscrowConfirmation(FIXTURE_CONTRACT_ID), { kind: "ready", contractId: FIXTURE_CONTRACT_ID });
});

test("describeEscrowConfirmation shows ESCROW_UNAVAILABLE and no id when the operator is not configured", () => {
  const view = describeEscrowConfirmation(undefined);
  assert.deepEqual(view, { kind: "unavailable", code: ESCROW_UNAVAILABLE_CODE });
  assert.equal(ESCROW_UNAVAILABLE_CODE, "ESCROW_UNAVAILABLE");
  assert.equal("contractId" in view, false);
});

test("describeEscrowConfirmation treats an empty id as unavailable", () => {
  assert.equal(describeEscrowConfirmation("").kind, "unavailable");
});

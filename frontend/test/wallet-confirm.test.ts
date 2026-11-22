import assert from "node:assert/strict";
import { test } from "node:test";

import { signingAddressMismatch, truncateWalletAddress } from "../src/lib/walletConfirmation";

test("wallet confirmation keeps a truncated address visible", () => {
  const address = "GABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
  assert.equal(truncateWalletAddress(address), "GABCDE…3456");
});

test("wallet confirmation detects a mismatch with the session address", () => {
  assert.equal(
    signingAddressMismatch("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1", "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2"),
    true,
  );
  assert.equal(
    signingAddressMismatch("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"),
    false,
  );
});

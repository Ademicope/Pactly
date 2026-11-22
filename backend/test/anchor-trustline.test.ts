/**
 * Issue #4's own read, exercised as a unit: "can this wallet hold the
 * anchor's USDC at all?". `loadAccount` and `resolveUsdcAsset` are both
 * injected, so no Horizon endpoint and no anchor is ever reached -- the
 * three rows the issue asks for (a missing trustline, a wrong issuer, a
 * matching trustline) plus its edge case (a Horizon that cannot be asked).
 */
import "./testConfigEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";

import { UsdcTrustlineMissingError } from "../src/anchor/errors.js";
import { accountHasUsdcTrustline, requireUsdcTrustline, type AccountHeldAssets } from "../src/anchor/trustline.js";
import { PaymentUnavailableError } from "../src/payments/errors.js";
import { FAKE_USDC, USDC_READY_WALLET_DEPS } from "./helpers.js";

const WALLET = Keypair.random().publicKey();
/** The anchor's USDC issuer, and a second, unrelated one: a matching code
 * with the wrong issuer must never count. */
const OTHER_ISSUER = Keypair.random().publicKey();

function holding(...balances: AccountHeldAssets["balances"]) {
  return { balances };
}

function readAccount(answer: AccountHeldAssets | Error) {
  return async (): Promise<AccountHeldAssets> => {
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

test("a wallet holding exactly the anchor's USDC code and issuer is ready", async () => {
  const ready = await accountHasUsdcTrustline(WALLET, FAKE_USDC.code, FAKE_USDC.issuer, {
    loadAccount: readAccount(holding({ asset_code: "USDC", asset_issuer: FAKE_USDC.issuer })),
  });
  assert.equal(ready, true);

  await requireUsdcTrustline(WALLET, {
    resolveUsdcAsset: async () => FAKE_USDC,
    loadAccount: readAccount(holding({ asset_code: "USDC", asset_issuer: FAKE_USDC.issuer })),
  });
});

test("a trustline for the same code issued by someone else does not count", async () => {
  const ready = await accountHasUsdcTrustline(WALLET, FAKE_USDC.code, FAKE_USDC.issuer, {
    loadAccount: readAccount(holding({ asset_code: "USDC", asset_issuer: OTHER_ISSUER })),
  });
  assert.equal(ready, false, "only the anchor's own issuer counts");

  await assert.rejects(
    () =>
      requireUsdcTrustline(WALLET, {
        resolveUsdcAsset: async () => FAKE_USDC,
        loadAccount: readAccount(holding({ asset_code: "USDC", asset_issuer: OTHER_ISSUER })),
      }),
    UsdcTrustlineMissingError,
  );
});

test("a wallet holding no USDC at all -- or an account Horizon does not know -- is not ready", async () => {
  const onlyNative = await accountHasUsdcTrustline(WALLET, FAKE_USDC.code, FAKE_USDC.issuer, {
    loadAccount: readAccount(holding({ balance: "100.0000000" })),
  });
  assert.equal(onlyNative, false, "the network's own asset carries no code or issuer to match");

  const noBalances = await accountHasUsdcTrustline(WALLET, FAKE_USDC.code, FAKE_USDC.issuer, {
    loadAccount: readAccount(holding({ asset_code: "XLM", asset_issuer: FAKE_USDC.issuer })),
  });
  assert.equal(noBalances, false);

  await assert.rejects(
    () =>
      requireUsdcTrustline(WALLET, {
        resolveUsdcAsset: async () => FAKE_USDC,
        loadAccount: readAccount(holding()),
      }),
    UsdcTrustlineMissingError,
  );
});

test("an account Horizon reports as not found has nothing to hold -- a `false`, not an error", async () => {
  const notFound = Object.assign(new Error("Account not found"), { name: "NotFoundError" });
  const ready = await accountHasUsdcTrustline(WALLET, FAKE_USDC.code, FAKE_USDC.issuer, {
    loadAccount: readAccount(notFound),
  });
  assert.equal(ready, false);
});

test("Edge case: a Horizon that cannot be reached refuses rather than reporting an unready wallet", async () => {
  const unreachable = Object.assign(new Error("connect ECONNREFUSED"), { name: "ServiceUnavailable" });
  await assert.rejects(
    () => accountHasUsdcTrustline(WALLET, FAKE_USDC.code, FAKE_USDC.issuer, { loadAccount: readAccount(unreachable) }),
    PaymentUnavailableError,
  );

  // ...and the same when it is the asset discovery that cannot answer: no
  // answer is never read as permission to move money.
  await assert.rejects(
    () =>
      requireUsdcTrustline(WALLET, {
        resolveUsdcAsset: async () => {
          throw new Error("anchor unreachable");
        },
      }),
    PaymentUnavailableError,
  );
});

test("the injected seams stay the seams: a ready wallet is read through them, never through the network", async () => {
  let trustlineQuestions = 0;
  await requireUsdcTrustline(WALLET, {
    ...USDC_READY_WALLET_DEPS,
    hasTrustline: async () => {
      trustlineQuestions += 1;
      return true;
    },
  });
  assert.equal(trustlineQuestions, 1);
});

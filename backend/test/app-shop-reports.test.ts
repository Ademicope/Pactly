/**
 * Story: Let a client report a shop to the admins (#75)
 *
 * A signed-in client can submit a report with a reason (max 500 chars)
 * against an approved shop. Admins can list reports, newest first.
 * The shop and public cannot see reports. A report does not change the
 * shop's status. Same client can report a shop once per day.
 */
import "./testConfigEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";

import { createApp } from "../src/app.js";
import { issuePactlyJwt } from "../src/auth/challenge.js";
import {
  closeDatabase,
  openTestDatabase,
  seedCategory,
  seedProviderProfile,
  type SeedProviderProfileOptions,
} from "./helpers.js";
import type { OpenDatabaseResult } from "../src/db/client.js";

/** The admin wallet `testConfigEnv.ts` puts in `PACTLY_ADMIN_WALLETS`. */
const TEST_ADMIN_WALLET = "GADMIN1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";

async function seedApprovedProvider(
  result: OpenDatabaseResult,
  overrides: SeedProviderProfileOptions = {},
): Promise<string> {
  const categoryId = await seedCategory(result);
  return seedProviderProfile(result, { categoryId, isApproved: true, ...overrides });
}

async function report(
  app: ReturnType<typeof createApp>,
  providerProfileId: string,
  token: string,
  reason: string,
): Promise<Response> {
  return app.request(`/providers/${providerProfileId}/report`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ reason }),
  });
}

test("Submit report successfully, and an admin can list it", async () => {
  const result = openTestDatabase();
  try {
    const app = createApp(result.db);
    const providerId = await seedApprovedProvider(result, { displayName: "Test Shop", title: "Test Service" });
    const clientWallet = Keypair.random().publicKey();
    const clientToken = await issuePactlyJwt(clientWallet);

    const reportRes = await report(app, providerId, clientToken, "This shop listing looks incorrect");
    assert.equal(reportRes.status, 201);
    const reportData = (await reportRes.json()) as { reportId: string };
    assert.equal(typeof reportData.reportId, "string");

    const adminToken = await issuePactlyJwt(TEST_ADMIN_WALLET);
    const listRes = await app.request("/admin/shop-reports", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as {
      reports: Array<{
        reason: string;
        reportedByWallet: string;
        provider: { id: string; displayName: string; isApproved: boolean };
      }>;
    };
    assert.ok(Array.isArray(listData.reports));
    assert.equal(listData.reports.length, 1);
    assert.equal(listData.reports[0]?.reason, "This shop listing looks incorrect");
    assert.equal(listData.reports[0]?.reportedByWallet, clientWallet);
    assert.equal(listData.reports[0]?.provider.id, providerId);
    assert.equal(listData.reports[0]?.provider.displayName, "Test Shop");
    assert.equal(listData.reports[0]?.provider.isApproved, true);
  } finally {
    closeDatabase(result);
  }
});

test("Empty or whitespace-only reason is rejected", async () => {
  const result = openTestDatabase();
  try {
    const app = createApp(result.db);
    const providerId = await seedApprovedProvider(result);
    const clientToken = await issuePactlyJwt(Keypair.random().publicKey());

    for (const reason of ["", "   "]) {
      const res = await report(app, providerId, clientToken, reason);
      assert.equal(res.status, 400);
      const data = (await res.json()) as { code: string };
      assert.equal(data.code, "INVALID_REASON");
    }
  } finally {
    closeDatabase(result);
  }
});

test("Reason over 500 chars is rejected", async () => {
  const result = openTestDatabase();
  try {
    const app = createApp(result.db);
    const providerId = await seedApprovedProvider(result);
    const clientToken = await issuePactlyJwt(Keypair.random().publicKey());

    const res = await report(app, providerId, clientToken, "a".repeat(501));
    assert.equal(res.status, 400);
    const data = (await res.json()) as { code: string };
    assert.equal(data.code, "INVALID_REASON");
  } finally {
    closeDatabase(result);
  }
});

test("Report against missing shop returns 404", async () => {
  const result = openTestDatabase();
  try {
    const app = createApp(result.db);
    const clientToken = await issuePactlyJwt(Keypair.random().publicKey());

    const res = await report(app, "nonexistent-shop-id", clientToken, "This shop looks suspicious");
    assert.equal(res.status, 404);
    const data = (await res.json()) as { code: string };
    assert.equal(data.code, "SHOP_NOT_FOUND");
  } finally {
    closeDatabase(result);
  }
});

test("Report against unapproved shop returns 404", async () => {
  const result = openTestDatabase();
  try {
    const app = createApp(result.db);
    const categoryId = await seedCategory(result);
    const providerId = await seedProviderProfile(result, {
      categoryId,
      displayName: "Unapproved Shop",
      isApproved: false,
    });
    const clientToken = await issuePactlyJwt(Keypair.random().publicKey());

    const res = await report(app, providerId, clientToken, "This shop looks suspicious");
    assert.equal(res.status, 404);
    const data = (await res.json()) as { code: string };
    assert.equal(data.code, "SHOP_NOT_FOUND");
  } finally {
    closeDatabase(result);
  }
});

test("Same client cannot report same shop within 24 hours (rate limit)", async () => {
  const result = openTestDatabase();
  try {
    const app = createApp(result.db);
    const providerId = await seedApprovedProvider(result);
    const clientToken = await issuePactlyJwt(Keypair.random().publicKey());

    const firstRes = await report(app, providerId, clientToken, "First report");
    assert.equal(firstRes.status, 201);

    const secondRes = await report(app, providerId, clientToken, "Second report");
    assert.equal(secondRes.status, 429);
    const data = (await secondRes.json()) as { code: string };
    assert.equal(data.code, "RATE_LIMIT");
  } finally {
    closeDatabase(result);
  }
});

test("Admin can list reports, newest first", async () => {
  const result = openTestDatabase();
  try {
    const app = createApp(result.db);
    const categoryId = await seedCategory(result);
    const provider1Id = await seedProviderProfile(result, {
      categoryId,
      displayName: "Shop One",
      isApproved: true,
    });
    const provider2Id = await seedProviderProfile(result, {
      categoryId,
      displayName: "Shop Two",
      isApproved: true,
    });
    const clientToken = await issuePactlyJwt(Keypair.random().publicKey());

    const firstRes = await report(app, provider1Id, clientToken, "First report");
    assert.equal(firstRes.status, 201);
    // Timestamps are whole seconds, so two reports in the same second would
    // tie. Move the older report back a minute to make "newest first" a real
    // assertion rather than a row-order accident.
    result.sqlite
      .prepare("UPDATE shop_reports SET created_at = created_at - 60 WHERE provider_profile_id = ?")
      .run(provider1Id);

    const secondRes = await report(app, provider2Id, clientToken, "Second report");
    assert.equal(secondRes.status, 201);

    const adminToken = await issuePactlyJwt(TEST_ADMIN_WALLET);
    const listRes = await app.request("/admin/shop-reports", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as {
      reports: Array<{ reason: string; provider: { displayName: string } }>;
    };
    assert.equal(listData.reports.length, 2);
    assert.equal(listData.reports[0]?.reason, "Second report");
    assert.equal(listData.reports[0]?.provider.displayName, "Shop Two");
    assert.equal(listData.reports[1]?.reason, "First report");
    assert.equal(listData.reports[1]?.provider.displayName, "Shop One");
  } finally {
    closeDatabase(result);
  }
});

test("Shop status unchanged after report", async () => {
  const result = openTestDatabase();
  try {
    const app = createApp(result.db);
    const providerId = await seedApprovedProvider(result, { displayName: "Test Shop" });

    const beforeRes = await app.request(`/providers/${providerId}`);
    assert.equal(beforeRes.status, 200);
    const beforeData = (await beforeRes.json()) as {
      isApproved: boolean;
      displayName: string;
      verifiedSessionCount: number;
    };
    assert.equal(beforeData.isApproved, true);

    const clientToken = await issuePactlyJwt(Keypair.random().publicKey());
    const reportRes = await report(app, providerId, clientToken, "Suspicious listing");
    assert.equal(reportRes.status, 201);

    const afterRes = await app.request(`/providers/${providerId}`);
    assert.equal(afterRes.status, 200);
    const afterData = (await afterRes.json()) as {
      isApproved: boolean;
      displayName: string;
      verifiedSessionCount: number;
    };
    assert.equal(afterData.isApproved, true);
    assert.equal(afterData.displayName, beforeData.displayName);
    assert.equal(afterData.verifiedSessionCount, beforeData.verifiedSessionCount);
  } finally {
    closeDatabase(result);
  }
});

test("Non-admin cannot access admin endpoint", async () => {
  const result = openTestDatabase();
  try {
    const app = createApp(result.db);
    const userToken = await issuePactlyJwt(Keypair.random().publicKey());

    const res = await app.request("/admin/shop-reports", {
      headers: { authorization: `Bearer ${userToken}` },
    });
    assert.equal(res.status, 404);
    const data = (await res.json()) as { code: string };
    assert.equal(data.code, "NOT_ADMIN");
  } finally {
    closeDatabase(result);
  }
});

test("Unauthenticated user cannot submit report", async () => {
  const result = openTestDatabase();
  try {
    const app = createApp(result.db);
    const providerId = await seedApprovedProvider(result);

    const res = await app.request(`/providers/${providerId}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "This shop looks incorrect" }),
    });
    assert.equal(res.status, 401);
    const data = (await res.json()) as { code: string };
    assert.equal(data.code, "unauthorized");
  } finally {
    closeDatabase(result);
  }
});

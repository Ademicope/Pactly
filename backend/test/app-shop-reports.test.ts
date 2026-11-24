/**
 * Story: Let a client report a shop to the admins (#75)
 *
 * A signed-in client can submit a report with a reason (max 500 chars)
 * against an approved shop. Admins can list reports, newest first.
 * The shop and public cannot see reports. A report does not change the
 * shop's status. Same client can report a shop once per day.
 */
import { describe, expect, test } from "bun:test";
import { testDb, testKp, testKp2, testKp3, testWallet, testWallet2, testWallet3 } from "./test-helpers.js";
import { createApp } from "../src/app.js";
import { issuePactlyJwt } from "../src/auth/challenge.js";
import { insertProviderProfile } from "../src/db/providerProfiles.js";
import { insertCategory } from "../src/db/categories.js";

describe("Shop reports", () => {
  test("Submit report successfully", async () => {
    const db = testDb();
    const app = createApp(db);

    // Set up: create an approved provider
    const categoryId = await insertCategory(db, { name: "Test Category", slug: "test-category" });
    const providerId = await insertProviderProfile(db, {
      walletAddress: testWallet,
      displayName: "Test Shop",
      title: "Test Service",
      categoryId,
      location: "Test City",
      serviceDescription: "Test description",
      sessionFormat: "in_person",
      sessionLengthMinutes: 60,
      priceAmount: "10000000",
      depositRateBps: 1000,
      cancellationWindowHours: 24,
      isApproved: true,
      verifiedSessionCount: 0,
    });

    // Client submits a report
    const clientToken = await issuePactlyJwt(testWallet2);
    const reportRes = await app.request(`/providers/${providerId}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ reason: "This shop listing looks incorrect" }),
    });

    expect(reportRes.status).toBe(201);
    const reportData = await reportRes.json();
    expect(reportData).toHaveProperty("reportId");
    expect(typeof reportData.reportId).toBe("string");

    // Admin can list reports
    const adminToken = await issuePactlyJwt(testWallet3);
    const listRes = await app.request("/admin/shop-reports", {
      method: "GET",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.reports).toBeArray();
    expect(listData.reports.length).toBe(1);
    expect(listData.reports[0].reason).toBe("This shop listing looks incorrect");
    expect(listData.reports[0].reportedByWallet).toBe(testWallet2);
    expect(listData.reports[0].provider.id).toBe(providerId);
    expect(listData.reports[0].provider.displayName).toBe("Test Shop");
    expect(listData.reports[0].provider.isApproved).toBe(true);
  });

  test("Empty reason is rejected", async () => {
    const db = testDb();
    const app = createApp(db);

    // Set up: create an approved provider
    const categoryId = await insertCategory(db, { name: "Test Category", slug: "test-category" });
    const providerId = await insertProviderProfile(db, {
      walletAddress: testWallet,
      displayName: "Test Shop",
      title: "Test Service",
      categoryId,
      location: "Test City",
      serviceDescription: "Test description",
      sessionFormat: "in_person",
      sessionLengthMinutes: 60,
      priceAmount: "10000000",
      depositRateBps: 1000,
      cancellationWindowHours: 24,
      isApproved: true,
      verifiedSessionCount: 0,
    });

    const clientToken = await issuePactlyJwt(testWallet2);
    
    // Empty string
    const emptyRes = await app.request(`/providers/${providerId}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ reason: "" }),
    });

    expect(emptyRes.status).toBe(400);
    const emptyData = await emptyRes.json();
    expect(emptyData.code).toBe("INVALID_REASON");

    // Whitespace only
    const whitespaceRes = await app.request(`/providers/${providerId}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ reason: "   " }),
    });

    expect(whitespaceRes.status).toBe(400);
    const whitespaceData = await whitespaceRes.json();
    expect(whitespaceData.code).toBe("INVALID_REASON");
  });

  test("Reason over 500 chars is rejected", async () => {
    const db = testDb();
    const app = createApp(db);

    // Set up: create an approved provider
    const categoryId = await insertCategory(db, { name: "Test Category", slug: "test-category" });
    const providerId = await insertProviderProfile(db, {
      walletAddress: testWallet,
      displayName: "Test Shop",
      title: "Test Service",
      categoryId,
      location: "Test City",
      serviceDescription: "Test description",
      sessionFormat: "in_person",
      sessionLengthMinutes: 60,
      priceAmount: "10000000",
      depositRateBps: 1000,
      cancellationWindowHours: 24,
      isApproved: true,
      verifiedSessionCount: 0,
    });

    const clientToken = await issuePactlyJwt(testWallet2);
    const longReason = "a".repeat(501);

    const res = await app.request(`/providers/${providerId}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ reason: longReason }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("INVALID_REASON");
  });

  test("Report against missing shop returns 404", async () => {
    const db = testDb();
    const app = createApp(db);

    const clientToken = await issuePactlyJwt(testWallet2);

    const res = await app.request("/providers/nonexistent-shop-id/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ reason: "This shop looks suspicious" }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("SHOP_NOT_FOUND");
  });

  test("Report against unapproved shop returns 404", async () => {
    const db = testDb();
    const app = createApp(db);

    // Set up: create an unapproved provider
    const categoryId = await insertCategory(db, { name: "Test Category", slug: "test-category" });
    const providerId = await insertProviderProfile(db, {
      walletAddress: testWallet,
      displayName: "Unapproved Shop",
      title: "Test Service",
      categoryId,
      location: "Test City",
      serviceDescription: "Test description",
      sessionFormat: "in_person",
      sessionLengthMinutes: 60,
      priceAmount: "10000000",
      depositRateBps: 1000,
      cancellationWindowHours: 24,
      isApproved: false, // Not approved
      verifiedSessionCount: 0,
    });

    const clientToken = await issuePactlyJwt(testWallet2);

    const res = await app.request(`/providers/${providerId}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ reason: "This shop looks suspicious" }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("SHOP_NOT_FOUND");
  });

  test("Same client cannot report same shop within 24 hours (rate limit)", async () => {
    const db = testDb();
    const app = createApp(db);

    // Set up: create an approved provider
    const categoryId = await insertCategory(db, { name: "Test Category", slug: "test-category" });
    const providerId = await insertProviderProfile(db, {
      walletAddress: testWallet,
      displayName: "Test Shop",
      title: "Test Service",
      categoryId,
      location: "Test City",
      serviceDescription: "Test description",
      sessionFormat: "in_person",
      sessionLengthMinutes: 60,
      priceAmount: "10000000",
      depositRateBps: 1000,
      cancellationWindowHours: 24,
      isApproved: true,
      verifiedSessionCount: 0,
    });

    const clientToken = await issuePactlyJwt(testWallet2);

    // First report - should succeed
    const firstRes = await app.request(`/providers/${providerId}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ reason: "First report" }),
    });

    expect(firstRes.status).toBe(201);

    // Second report immediately - should be rate limited
    const secondRes = await app.request(`/providers/${providerId}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ reason: "Second report" }),
    });

    expect(secondRes.status).toBe(429);
    const data = await secondRes.json();
    expect(data.code).toBe("RATE_LIMIT");
  });

  test("Admin can list reports, newest first", async () => {
    const db = testDb();
    const app = createApp(db);

    // Set up: create approved providers
    const categoryId = await insertCategory(db, { name: "Test Category", slug: "test-category" });
    const provider1Id = await insertProviderProfile(db, {
      walletAddress: testWallet,
      displayName: "Shop One",
      title: "Test Service",
      categoryId,
      location: "Test City",
      serviceDescription: "Test description",
      sessionFormat: "in_person",
      sessionLengthMinutes: 60,
      priceAmount: "10000000",
      depositRateBps: 1000,
      cancellationWindowHours: 24,
      isApproved: true,
      verifiedSessionCount: 0,
    });

    const provider2Id = await insertProviderProfile(db, {
      walletAddress: testWallet2,
      displayName: "Shop Two",
      title: "Another Service",
      categoryId,
      location: "Another City",
      serviceDescription: "Another description",
      sessionFormat: "video",
      sessionLengthMinutes: 30,
      priceAmount: "5000000",
      depositRateBps: 500,
      cancellationWindowHours: 12,
      isApproved: true,
      verifiedSessionCount: 5,
    });

    // Client reports both shops
    const clientToken = await issuePactlyJwt(testWallet3);

    await app.request(`/providers/${provider1Id}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ reason: "First report" }),
    });

    // Wait a tiny bit to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));

    await app.request(`/providers/${provider2Id}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ reason: "Second report" }),
    });

    // Admin lists reports
    const adminToken = await issuePactlyJwt(testWallet3);
    const listRes = await app.request("/admin/shop-reports", {
      method: "GET",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.reports).toBeArray();
    expect(listData.reports.length).toBe(2);

    // Newest first
    expect(listData.reports[0].reason).toBe("Second report");
    expect(listData.reports[0].provider.displayName).toBe("Shop Two");
    expect(listData.reports[1].reason).toBe("First report");
    expect(listData.reports[1].provider.displayName).toBe("Shop One");
  });

  test("Shop status unchanged after report", async () => {
    const db = testDb();
    const app = createApp(db);

    // Set up: create an approved provider
    const categoryId = await insertCategory(db, { name: "Test Category", slug: "test-category" });
    const providerId = await insertProviderProfile(db, {
      walletAddress: testWallet,
      displayName: "Test Shop",
      title: "Test Service",
      categoryId,
      location: "Test City",
      serviceDescription: "Test description",
      sessionFormat: "in_person",
      sessionLengthMinutes: 60,
      priceAmount: "10000000",
      depositRateBps: 1000,
      cancellationWindowHours: 24,
      isApproved: true,
      verifiedSessionCount: 0,
    });

    // Get shop before report
    const beforeRes = await app.request(`/providers/${providerId}`);
    expect(beforeRes.status).toBe(200);
    const beforeData = await beforeRes.json();
    expect(beforeData.isApproved).toBe(true);

    // Client submits a report
    const clientToken = await issuePactlyJwt(testWallet2);
    await app.request(`/providers/${providerId}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ reason: "Suspicious listing" }),
    });

    // Get shop after report - should be unchanged
    const afterRes = await app.request(`/providers/${providerId}`);
    expect(afterRes.status).toBe(200);
    const afterData = await afterRes.json();
    expect(afterData.isApproved).toBe(true);
    expect(afterData.displayName).toBe(beforeData.displayName);
    expect(afterData.verifiedSessionCount).toBe(beforeData.verifiedSessionCount);
  });

  test("Non-admin cannot access admin endpoint", async () => {
    const db = testDb();
    const app = createApp(db);

    // Regular user (non-admin) tries to list reports
    const userToken = await issuePactlyJwt(testWallet2);
    const res = await app.request("/admin/shop-reports", {
      method: "GET",
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("NOT_ADMIN");
  });

  test("Unauthenticated user cannot submit report", async () => {
    const db = testDb();
    const app = createApp(db);

    // Set up: create an approved provider
    const categoryId = await insertCategory(db, { name: "Test Category", slug: "test-category" });
    const providerId = await insertProviderProfile(db, {
      walletAddress: testWallet,
      displayName: "Test Shop",
      title: "Test Service",
      categoryId,
      location: "Test City",
      serviceDescription: "Test description",
      sessionFormat: "in_person",
      sessionLengthMinutes: 60,
      priceAmount: "10000000",
      depositRateBps: 1000,
      cancellationWindowHours: 24,
      isApproved: true,
      verifiedSessionCount: 0,
    });

    // No auth header
    const res = await app.request(`/providers/${providerId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "This shop looks incorrect" }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("unauthorized");
  });
});

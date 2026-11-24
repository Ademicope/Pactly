/**
 * Story: Let a client save shops they want to book again (#73)
 *
 * A signed-in client can save and unsave an approved shop. A saved-shops
 * page lists them and links to the profile. A suspended or self-paused shop
 * stays on the list and is marked not taking bookings. Another client does
 * not see the list. Saving twice is a no-op. A shop the client has a booking
 * with is not saved automatically.
 */
import { describe, expect, test } from "bun:test";
import { testDb, testKp, testKp2, testKp3, testWallet, testWallet2, testWallet3 } from "./test-helpers.js";
import { createApp } from "../src/app.js";
import { issuePactlyJwt } from "../src/auth/challenge.js";
import { insertProviderProfile } from "../src/db/providerProfiles.js";
import { insertCategory } from "../src/db/categories.js";

describe("Saved shops", () => {
  test("Save shop successfully", async () => {
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

    // Client saves the shop
    const clientToken = await issuePactlyJwt(testWallet2);
    const saveRes = await app.request(`/providers/${providerId}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
    });

    expect(saveRes.status).toBe(201);
    const saveData = await saveRes.json();
    expect(saveData).toHaveProperty("savedShopId");
    expect(typeof saveData.savedShopId).toBe("string");

    // Check if shop is saved
    const checkRes = await app.request(`/providers/${providerId}/saved`, {
      method: "GET",
      headers: { Authorization: `Bearer ${clientToken}` },
    });

    expect(checkRes.status).toBe(200);
    const checkData = await checkRes.json();
    expect(checkData.isSaved).toBe(true);

    // List saved shops
    const listRes = await app.request("/me/saved-shops", {
      method: "GET",
      headers: { Authorization: `Bearer ${clientToken}` },
    });

    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.shops).toBeArray();
    expect(listData.shops.length).toBe(1);
    expect(listData.shops[0].provider.id).toBe(providerId);
    expect(listData.shops[0].provider.displayName).toBe("Test Shop");
  });

  test("Saving twice is a no-op", async () => {
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

    // Save first time
    const firstRes = await app.request(`/providers/${providerId}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
    });
    expect(firstRes.status).toBe(201);

    // Save second time - should be idempotent
    const secondRes = await app.request(`/providers/${providerId}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
    });
    expect(secondRes.status).toBe(201);

    // Should still have only one saved shop
    const listRes = await app.request("/me/saved-shops", {
      method: "GET",
      headers: { Authorization: `Bearer ${clientToken}` },
    });

    const listData = await listRes.json();
    expect(listData.shops.length).toBe(1);
  });

  test("Unsave shop successfully", async () => {
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

    // Save the shop
    await app.request(`/providers/${providerId}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
    });

    // Unsave the shop
    const unsaveRes = await app.request(`/providers/${providerId}/save`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${clientToken}` },
    });

    expect(unsaveRes.status).toBe(200);
    const unsaveData = await unsaveRes.json();
    expect(unsaveData.unsaved).toBe(true);

    // Check if shop is no longer saved
    const checkRes = await app.request(`/providers/${providerId}/saved`, {
      method: "GET",
      headers: { Authorization: `Bearer ${clientToken}` },
    });

    const checkData = await checkRes.json();
    expect(checkData.isSaved).toBe(false);

    // List should be empty
    const listRes = await app.request("/me/saved-shops", {
      method: "GET",
      headers: { Authorization: `Bearer ${clientToken}` },
    });

    const listData = await listRes.json();
    expect(listData.shops.length).toBe(0);
  });

  test("Cannot save unapproved shop", async () => {
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

    const res = await app.request(`/providers/${providerId}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("SHOP_NOT_APPROVED");
  });

  test("Cannot save nonexistent shop", async () => {
    const db = testDb();
    const app = createApp(db);

    const clientToken = await issuePactlyJwt(testWallet2);

    const res = await app.request("/providers/nonexistent-shop-id/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("SHOP_NOT_FOUND");
  });

  test("Another client does not see the list", async () => {
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

    // Client 1 saves the shop
    const client1Token = await issuePactlyJwt(testWallet2);
    await app.request(`/providers/${providerId}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${client1Token}`,
      },
    });

    // Client 2 should not see it in their list
    const client2Token = await issuePactlyJwt(testWallet3);
    const listRes = await app.request("/me/saved-shops", {
      method: "GET",
      headers: { Authorization: `Bearer ${client2Token}` },
    });

    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.shops.length).toBe(0);
  });

  test("Suspended shop stays on the list and is marked not taking bookings", async () => {
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

    // Client saves the shop
    const clientToken = await issuePactlyJwt(testWallet2);
    await app.request(`/providers/${providerId}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
    });

    // Suspend the shop (set isApproved to false)
    await db
      .update(await import("../src/db/schema.js").then((m) => m.providerProfiles))
      .set({ isApproved: false })
      .where(
        (await import("drizzle-orm").then((m) => m.eq))(
          (await import("../src/db/schema.js").then((m) => m.providerProfiles)).id,
          providerId,
        ),
      )
      .run();

    // List should still include the shop, with isApproved: false
    const listRes = await app.request("/me/saved-shops", {
      method: "GET",
      headers: { Authorization: `Bearer ${clientToken}` },
    });

    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.shops.length).toBe(1);
    expect(listData.shops[0].provider.isApproved).toBe(false);
  });

  test("List saved shops newest first", async () => {
    const db = testDb();
    const app = createApp(db);

    // Set up: create multiple approved providers
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

    const clientToken = await issuePactlyJwt(testWallet3);

    // Save provider1 first
    await app.request(`/providers/${provider1Id}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
    });

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Save provider2 second
    await app.request(`/providers/${provider2Id}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientToken}`,
      },
    });

    // List should show provider2 first (newest)
    const listRes = await app.request("/me/saved-shops", {
      method: "GET",
      headers: { Authorization: `Bearer ${clientToken}` },
    });

    const listData = await listRes.json();
    expect(listData.shops.length).toBe(2);
    expect(listData.shops[0].provider.displayName).toBe("Shop Two");
    expect(listData.shops[1].provider.displayName).toBe("Shop One");
  });

  test("Unauthenticated user cannot save shop", async () => {
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
    const res = await app.request(`/providers/${providerId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("unauthorized");
  });

  test("Unauthenticated user cannot list saved shops", async () => {
    const db = testDb();
    const app = createApp(db);

    // No auth header
    const res = await app.request("/me/saved-shops", {
      method: "GET",
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("unauthorized");
  });
});

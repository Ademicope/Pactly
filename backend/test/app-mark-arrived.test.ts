/**
 * Test for marking a client as arrived.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";
import { closeDatabase, openTestDatabase } from "./db.js";
import { seedProviderProfile } from "./helpers.js";
import { createBookingHold } from "../src/services/booking.js";

test("POST /bookings/:id/arrived refuses before appointment start", async () => {
  const result = openTestDatabase();
  try {
    const now = Math.floor(Date.now() / 1000);
    const providerWallet = "GPROVIDERARRIVED";
    const providerProfileId = await seedProviderProfile(result, { isApproved: true, walletAddress: providerWallet });
    
    const futureSlot = now + 3600; // 1 hour in future
    const bookingId = await createBookingHold(result.db, {
      providerProfileId,
      clientWalletAddress: "GCLIENTARRIVED",
      tokenAddress: "CUSDC",
      depositAmount: "1000000",
      cancelDeadline: futureSlot - 86400,
      slotId: "slot-future",
      holdExpiresAt: now + 600,
    });
    
    // Force escrowState to locked (normally set by reconciler)
    await result.db.run(`UPDATE bookings SET escrow_state = 'locked' WHERE id = ?`, [bookingId]);
    
    // Create the slot
    await result.db.run(
      `INSERT INTO availability_slots (id, provider_profile_id, starts_at, created_at) VALUES (?, ?, ?, ?)`,
      ["slot-future", providerProfileId, futureSlot, Date.now()]
    );
    
    const app = createApp(result.db);
    const response = await app.request(`/bookings/${bookingId}/arrived`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerWallet}` },
    });
    
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "BOOKING_STATE");
  } finally {
    closeDatabase(result);
  }
});

test("POST /bookings/:id/arrived accepts at or after appointment start", async () => {
  const result = openTestDatabase();
  try {
    const now = Math.floor(Date.now() / 1000);
    const providerWallet = "GPROVIDERARRIVED2";
    const providerProfileId = await seedProviderProfile(result, { isApproved: true, walletAddress: providerWallet });
    
    const pastSlot = now - 300; // 5 minutes ago
    const bookingId = await createBookingHold(result.db, {
      providerProfileId,
      clientWalletAddress: "GCLIENTARRIVED2",
      tokenAddress: "CUSDC",
      depositAmount: "1000000",
      cancelDeadline: pastSlot - 86400,
      slotId: "slot-past",
      holdExpiresAt: now + 600,
    });
    
    // Force escrowState to locked
    await result.db.run(`UPDATE bookings SET escrow_state = 'locked' WHERE id = ?`, [bookingId]);
    
    // Create the slot
    await result.db.run(
      `INSERT INTO availability_slots (id, provider_profile_id, starts_at, created_at) VALUES (?, ?, ?, ?)`,
      ["slot-past", providerProfileId, pastSlot, Date.now()]
    );
    
    const app = createApp(result.db);
    const response = await app.request(`/bookings/${bookingId}/arrived`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerWallet}` },
    });
    
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    
    // Verify arrivedAt was set
    const booking = await result.db.get(`SELECT arrived_at FROM bookings WHERE id = ?`, [bookingId]);
    assert.ok(booking.arrived_at);
    assert.ok(booking.arrived_at <= now + 1); // Within 1 second of now
  } finally {
    closeDatabase(result);
  }
});

test("POST /bookings/:id/arrived keeps first timestamp on second call", async () => {
  const result = openTestDatabase();
  try {
    const now = Math.floor(Date.now() / 1000);
    const providerWallet = "GPROVIDERARRIVED3";
    const providerProfileId = await seedProviderProfile(result, { isApproved: true, walletAddress: providerWallet });
    
    const pastSlot = now - 300;
    const bookingId = await createBookingHold(result.db, {
      providerProfileId,
      clientWalletAddress: "GCLIENTARRIVED3",
      tokenAddress: "CUSDC",
      depositAmount: "1000000",
      cancelDeadline: pastSlot - 86400,
      slotId: "slot-past2",
      holdExpiresAt: now + 600,
    });
    
    await result.db.run(`UPDATE bookings SET escrow_state = 'locked' WHERE id = ?`, [bookingId]);
    
    await result.db.run(
      `INSERT INTO availability_slots (id, provider_profile_id, starts_at, created_at) VALUES (?, ?, ?, ?)`,
      ["slot-past2", providerProfileId, pastSlot, Date.now()]
    );
    
    const app = createApp(result.db);
    
    // First call
    const response1 = await app.request(`/bookings/${bookingId}/arrived`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerWallet}` },
    });
    assert.equal(response1.status, 200);
    
    const booking1 = await result.db.get(`SELECT arrived_at FROM bookings WHERE id = ?`, [bookingId]);
    const firstTimestamp = booking1.arrived_at;
    assert.ok(firstTimestamp);
    
    // Second call
    const response2 = await app.request(`/bookings/${bookingId}/arrived`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerWallet}` },
    });
    assert.equal(response2.status, 200);
    
    const booking2 = await result.db.get(`SELECT arrived_at FROM bookings WHERE id = ?`, [bookingId]);
    assert.equal(booking2.arrived_at, firstTimestamp, "Second call should keep first timestamp");
  } finally {
    closeDatabase(result);
  }
});

test("POST /bookings/:id/arrived refuses for client", async () => {
  const result = openTestDatabase();
  try {
    const now = Math.floor(Date.now() / 1000);
    const providerWallet = "GPROVIDERARRIVED4";
    const clientWallet = "GCLIENTARRIVED4";
    const providerProfileId = await seedProviderProfile(result, { isApproved: true, walletAddress: providerWallet });
    
    const pastSlot = now - 300;
    const bookingId = await createBookingHold(result.db, {
      providerProfileId,
      clientWalletAddress: clientWallet,
      tokenAddress: "CUSDC",
      depositAmount: "1000000",
      cancelDeadline: pastSlot - 86400,
      slotId: "slot-past3",
      holdExpiresAt: now + 600,
    });
    
    await result.db.run(`UPDATE bookings SET escrow_state = 'locked' WHERE id = ?`, [bookingId]);
    
    await result.db.run(
      `INSERT INTO availability_slots (id, provider_profile_id, starts_at, created_at) VALUES (?, ?, ?, ?)`,
      ["slot-past3", providerProfileId, pastSlot, Date.now()]
    );
    
    const app = createApp(result.db);
    
    // Client tries to mark arrived
    const response = await app.request(`/bookings/${bookingId}/arrived`, {
      method: "POST",
      headers: { Authorization: `Bearer ${clientWallet}` },
    });
    
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.code, "BOOKING_NOT_FOUND");
  } finally {
    closeDatabase(result);
  }
});

/**
 * Issue #119: a client cancels their own unlocked hold and the slot becomes
 * available again. Locked, expired and other clients' holds are refused.
 */
import "./testConfigEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";

import { createApp } from "../src/app.js";
import { issuePactlyJwt } from "../src/auth/challenge.js";
import {
  BookingEscrowStateError,
  BookingHoldExpiredError,
  BookingNotFoundError,
  cancelHold,
  holdSlot,
  SlotTakenError,
} from "../src/services/booking.js";
import { replaceFutureSlots } from "../src/db/availabilitySlots.js";
import { getBookingById, recordDeploySubmission, updateEscrowContractId, updateEscrowStateSync } from "../src/db/bookings.js";
import { closeDatabase, openTestDatabase, seedProviderProfile } from "./helpers.js";

const resolveUsdc = async () => ({ contractId: "CUSDCFAKECONTRACTID000000000000000000000000000000" });

async function seedHold(clientWalletAddress: string, now: number) {
  const result = openTestDatabase();
  const providerProfileId = await seedProviderProfile(result, { isApproved: true });
  const slotStartsAt = now + 3600;
  await replaceFutureSlots(result.db, providerProfileId, [slotStartsAt], now);
  const hold = await holdSlot(
    result.db,
    { providerProfileId, clientWalletAddress, slotStartsAt },
    { now, resolveUsdcAsset: resolveUsdc },
  );
  return { result, providerProfileId, slotStartsAt, hold };
}

test("cancelHold frees the slot for the owning client so another client can hold it", async () => {
  const now = 1_000_000;
  const owner = Keypair.random().publicKey();
  const other = Keypair.random().publicKey();
  const { result, providerProfileId, slotStartsAt, hold } = await seedHold(owner, now);
  try {
    await assert.rejects(
      () => holdSlot(result.db, { providerProfileId, clientWalletAddress: other, slotStartsAt }, { now, resolveUsdcAsset: resolveUsdc }),
      SlotTakenError,
    );

    await cancelHold(result.db, hold.bookingId, owner, now + 10);

    assert.equal(await getBookingById(result.db, hold.bookingId), undefined);
    const next = await holdSlot(
      result.db,
      { providerProfileId, clientWalletAddress: other, slotStartsAt },
      { now: now + 11, resolveUsdcAsset: resolveUsdc },
    );
    assert.ok(next.bookingId);
  } finally {
    closeDatabase(result);
  }
});

test("cancelHold refuses another client's hold as not found and leaves the slot held", async () => {
  const now = 1_000_000;
  const owner = Keypair.random().publicKey();
  const { result, hold } = await seedHold(owner, now);
  try {
    await assert.rejects(() => cancelHold(result.db, hold.bookingId, Keypair.random().publicKey(), now + 10), BookingNotFoundError);
    assert.ok(await getBookingById(result.db, hold.bookingId));
  } finally {
    closeDatabase(result);
  }
});

test("cancelHold refuses a locked booking", async () => {
  const now = 1_000_000;
  const owner = Keypair.random().publicKey();
  const { result, hold } = await seedHold(owner, now);
  try {
    updateEscrowStateSync(result.db, hold.bookingId, "locked");
    await assert.rejects(() => cancelHold(result.db, hold.bookingId, owner, now + 10), BookingEscrowStateError);
    assert.ok(await getBookingById(result.db, hold.bookingId));
  } finally {
    closeDatabase(result);
  }
});

test("cancelHold refuses a hold whose deploy was already submitted", async () => {
  const now = 1_000_000;
  const owner = Keypair.random().publicKey();
  const { result, hold } = await seedHold(owner, now);
  try {
    await updateEscrowContractId(result.db, hold.bookingId, "CFAKECONTRACT", "fake-xdr", "deploy-tx-hash");
    await recordDeploySubmission(result.db, hold.bookingId, "CFAKECONTRACT", "deploy-tx-hash", now + 600, now);
    await assert.rejects(() => cancelHold(result.db, hold.bookingId, owner, now + 10), BookingEscrowStateError);
    assert.ok(await getBookingById(result.db, hold.bookingId));
  } finally {
    closeDatabase(result);
  }
});

test("cancelHold on an expired hold says it expired and changes nothing", async () => {
  const now = 1_000_000;
  const owner = Keypair.random().publicKey();
  const { result, hold } = await seedHold(owner, now);
  try {
    const afterExpiry = hold.holdExpiresAt + 1;
    await assert.rejects(() => cancelHold(result.db, hold.bookingId, owner, afterExpiry), BookingHoldExpiredError);
    const row = await getBookingById(result.db, hold.bookingId);
    assert.equal(row?.holdExpiresAt, hold.holdExpiresAt);
  } finally {
    closeDatabase(result);
  }
});

test("DELETE /bookings/:id/hold maps ok, not found and expired", async () => {
  const now = Math.floor(Date.now() / 1000);
  const owner = Keypair.random().publicKey();
  const { result, hold } = await seedHold(owner, now);
  try {
    const app = createApp(result.db);
    const ownerHeaders = { authorization: `Bearer ${await issuePactlyJwt(owner)}` };
    const otherHeaders = { authorization: `Bearer ${await issuePactlyJwt(Keypair.random().publicKey())}` };

    const foreign = await app.request(`/bookings/${hold.bookingId}/hold`, { method: "DELETE", headers: otherHeaders });
    assert.equal(foreign.status, 404);
    assert.equal(((await foreign.json()) as { code: string }).code, "BOOKING_NOT_FOUND");

    const ok = await app.request(`/bookings/${hold.bookingId}/hold`, { method: "DELETE", headers: ownerHeaders });
    assert.equal(ok.status, 200);
    assert.equal(await getBookingById(result.db, hold.bookingId), undefined);
  } finally {
    closeDatabase(result);
  }
});

test("DELETE /bookings/:id/hold answers 409 HOLD_EXPIRED for an expired hold and 409 BOOKING_STATE for a locked one", async () => {
  const now = Math.floor(Date.now() / 1000);
  const owner = Keypair.random().publicKey();
  const { result, hold } = await seedHold(owner, now);
  try {
    const app = createApp(result.db);
    const headers = { authorization: `Bearer ${await issuePactlyJwt(owner)}` };

    const { bookings } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    await result.db.update(bookings).set({ holdExpiresAt: now - 1 }).where(eq(bookings.id, hold.bookingId));
    const expired = await app.request(`/bookings/${hold.bookingId}/hold`, { method: "DELETE", headers });
    assert.equal(expired.status, 409);
    assert.equal(((await expired.json()) as { code: string }).code, "HOLD_EXPIRED");

    updateEscrowStateSync(result.db, hold.bookingId, "locked");
    const locked = await app.request(`/bookings/${hold.bookingId}/hold`, { method: "DELETE", headers });
    assert.equal(locked.status, 409);
    assert.equal(((await locked.json()) as { code: string }).code, "BOOKING_STATE");
  } finally {
    closeDatabase(result);
  }
});

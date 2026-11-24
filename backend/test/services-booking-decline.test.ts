/**
 * `declineHold`: a shop turns away an unlocked hold on its own slot. The
 * slot becomes available again, the client's views report the hold as
 * declined, and a locked booking or another shop's booking is refused.
 */
import "./testConfigEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";

import {
  BookingEscrowStateError,
  BookingNotFoundError,
  declineHold,
  fundDeposit,
  getBookingView,
  holdSlot,
  listBookingsForClient,
  listBookingsForProvider,
  lockDeposit,
} from "../src/services/booking.js";
import { getPublicProviderProfile } from "../src/services/profile.js";
import { replaceFutureSlots } from "../src/db/availabilitySlots.js";
import { getBookingById, updateEscrowContractId, updateEscrowStateSync } from "../src/db/bookings.js";
import { closeDatabase, openTestDatabase, seedProviderProfile } from "./helpers.js";

const FAKE_USDC_DEPS = { resolveUsdcAsset: async () => ({ contractId: "CUSDCFAKE00000000000000000000000000000000000000000" }) };
const NOW = 1_000_000;

async function seedHold() {
  const result = openTestDatabase();
  const providerWallet = Keypair.random().publicKey();
  const clientWallet = Keypair.random().publicKey();
  const providerProfileId = await seedProviderProfile(result, { isApproved: true, walletAddress: providerWallet });
  const slotStartsAt = NOW + 3600;
  await replaceFutureSlots(result.db, providerProfileId, [slotStartsAt], NOW);
  const hold = await holdSlot(
    result.db,
    { providerProfileId, clientWalletAddress: clientWallet, slotStartsAt },
    { now: NOW, resolveUsdcAsset: FAKE_USDC_DEPS.resolveUsdcAsset },
  );
  return { result, providerWallet, clientWallet, providerProfileId, slotStartsAt, bookingId: hold.bookingId };
}

test("declineHold frees the slot and records the declined state", async () => {
  const seed = await seedHold();
  try {
    const before = await getPublicProviderProfile(seed.result.db, seed.providerProfileId, NOW);
    assert.deepEqual(before.slots, []);

    await declineHold(seed.result.db, seed.bookingId, seed.providerWallet, NOW + 10);

    const booking = await getBookingById(seed.result.db, seed.bookingId);
    assert.equal(booking?.declinedAt, NOW + 10);

    const after = await getPublicProviderProfile(seed.result.db, seed.providerProfileId, NOW + 10);
    assert.deepEqual(after.slots, [seed.slotStartsAt]);

    const secondClient = Keypair.random().publicKey();
    const rebooked = await holdSlot(
      seed.result.db,
      { providerProfileId: seed.providerProfileId, clientWalletAddress: secondClient, slotStartsAt: seed.slotStartsAt },
      { now: NOW + 10, resolveUsdcAsset: FAKE_USDC_DEPS.resolveUsdcAsset },
    );
    assert.notEqual(rebooked.bookingId, seed.bookingId);
  } finally {
    closeDatabase(seed.result);
  }
});

test("the client sees a declined hold as declined, never as an expired one", async () => {
  const seed = await seedHold();
  try {
    await declineHold(seed.result.db, seed.bookingId, seed.providerWallet, NOW + 10);

    const view = await getBookingView(seed.result.db, seed.bookingId, seed.clientWallet, NOW + 20);
    assert.equal(view.declinedAt, NOW + 10);

    const [clientItem] = await listBookingsForClient(seed.result.db, seed.clientWallet, NOW + 20);
    assert.equal(clientItem?.declinedAt, NOW + 10);
    assert.equal(clientItem?.isExpiredHold, false);

    const [providerItem] = await listBookingsForProvider(seed.result.db, seed.providerWallet, NOW + 20);
    assert.equal(providerItem?.declinedAt, NOW + 10);
  } finally {
    closeDatabase(seed.result);
  }
});

test("a declined hold can no longer be locked or funded", async () => {
  const seed = await seedHold();
  try {
    await updateEscrowContractId(seed.result.db, seed.bookingId, "CFAKECONTRACT000000000000000000000000000000000000");
    await declineHold(seed.result.db, seed.bookingId, seed.providerWallet, NOW + 10);

    await assert.rejects(lockDeposit(seed.result.db, seed.bookingId, undefined, { now: NOW + 20 }), BookingEscrowStateError);
    await assert.rejects(fundDeposit(seed.result.db, seed.bookingId, undefined, { now: NOW + 20 }), BookingEscrowStateError);
  } finally {
    closeDatabase(seed.result);
  }
});

test("declineHold refuses a locked booking", async () => {
  const seed = await seedHold();
  try {
    await updateEscrowContractId(seed.result.db, seed.bookingId, "CFAKECONTRACT000000000000000000000000000000000000");
    updateEscrowStateSync(seed.result.db, seed.bookingId, "locked");

    await assert.rejects(declineHold(seed.result.db, seed.bookingId, seed.providerWallet, NOW + 10), BookingEscrowStateError);

    const booking = await getBookingById(seed.result.db, seed.bookingId);
    assert.equal(booking?.declinedAt, null);
  } finally {
    closeDatabase(seed.result);
  }
});

test("declineHold refuses a hold that was already declined", async () => {
  const seed = await seedHold();
  try {
    await declineHold(seed.result.db, seed.bookingId, seed.providerWallet, NOW + 10);
    await assert.rejects(declineHold(seed.result.db, seed.bookingId, seed.providerWallet, NOW + 11), BookingEscrowStateError);
  } finally {
    closeDatabase(seed.result);
  }
});

test("another shop cannot decline the hold", async () => {
  const seed = await seedHold();
  try {
    const otherWallet = Keypair.random().publicKey();
    await seedProviderProfile(seed.result, { isApproved: true, walletAddress: otherWallet });

    await assert.rejects(declineHold(seed.result.db, seed.bookingId, otherWallet, NOW + 10), BookingNotFoundError);
    await assert.rejects(declineHold(seed.result.db, seed.bookingId, seed.clientWallet, NOW + 10), BookingNotFoundError);

    const booking = await getBookingById(seed.result.db, seed.bookingId);
    assert.equal(booking?.declinedAt, null);
  } finally {
    closeDatabase(seed.result);
  }
});

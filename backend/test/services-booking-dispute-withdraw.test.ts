/**
 * `services/booking.ts` dispute withdrawal tests -- no network access.
 */
import "./testConfigEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { Keypair } from "@stellar/stellar-sdk";

import {
  BookingNotFoundError,
  DisputeAlreadyResolvedError,
  UnauthorizedDisputeWithdrawalError,
  withdrawDispute,
} from "../src/services/booking.js";
import { bookings, escrowDisputeOpenings } from "../src/db/schema.js";
import { closeDatabase, openTestDatabase, seedBooking, seedProviderProfile } from "./helpers.js";
import { getBookingById, recordDeploySubmission, updateEscrowContractId, updateEscrowStateSync } from "../src/db/bookings.js";
import { recordEscrowDisputeOpening } from "../src/db/escrowDisputeOpenings.js";

const fakeContractId = () => "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH";

test("withdrawDispute allows the opener to withdraw an unresolved dispute", async () => {
  const result = openTestDatabase();
  try {
    const providerProfileId = await seedProviderProfile(result, { isApproved: true });
    const bookingId = await seedBooking(result, { providerProfileId });
    const contractId = fakeContractId();
    const now = Math.floor(Date.now() / 1000);
    const clientWallet = Keypair.random().publicKey();
    
    // Set up booking with client wallet
    await result.db.update(bookings).set({ clientWalletAddress: clientWallet }).where(eq(bookings.id, bookingId));
    
    // Deploy and fund
    await updateEscrowContractId(result.db, bookingId, contractId, "unsigned-xdr", "deploy-tx-hash");
    await recordDeploySubmission(result.db, bookingId, contractId, "deploy-tx-hash", now - 100, now - 700);
    await updateEscrowStateSync(result.db, bookingId, "locked");
    
    // Open a dispute (record the opening)
    await recordEscrowDisputeOpening(result.db, {
      bookingId,
      contractId,
      openedByWallet: clientWallet,
      openedByRole: "client",
      reason: "client-cancel",
      suggestedOutcome: "refund-client",
      txHash: "dispute-tx-hash",
      openedAt: now,
    });
    await result.db.update(bookings).set({
      escrowState: "disputed",
      escrowDisputeSubmittedAt: now,
      pendingDisputeOpenerWallet: clientWallet,
      pendingDisputeOpenerRole: "client",
      pendingDisputeReason: "client-cancel",
    }).where(eq(bookings.id, bookingId));

    // Withdraw as the opener
    const result2 = await withdrawDispute(result.db, bookingId, clientWallet, now + 10);
    
    assert.equal(result2.bookingId, bookingId);
    assert.equal(result2.escrowState, "locked");
    assert.equal(result2.withdrawnAt, now + 10);
    
    // Verify booking state is back to locked
    const booking = await getBookingById(result.db, bookingId);
    assert.equal(booking?.escrowState, "locked");
    assert.equal(booking?.pendingDisputeOpenerWallet, null);
    assert.equal(booking?.escrowDisputeSubmittedAt, null);
    
    // Verify dispute opening has withdrawnAt set
    const opening = await result.db.select().from(escrowDisputeOpenings).where(eq(escrowDisputeOpenings.bookingId, bookingId)).limit(1);
    assert.equal(opening[0]?.withdrawnAt, now + 10);
  } finally {
    closeDatabase(result);
  }
});

test("withdrawDispute rejects unauthorized withdrawal (not the opener)", async () => {
  const result = openTestDatabase();
  try {
    const providerProfileId = await seedProviderProfile(result, { isApproved: true });
    const bookingId = await seedBooking(result, { providerProfileId });
    const contractId = fakeContractId();
    const now = Math.floor(Date.now() / 1000);
    const clientWallet = Keypair.random().publicKey();
    const otherWallet = Keypair.random().publicKey();
    
    await result.db.update(bookings).set({ clientWalletAddress: clientWallet }).where(eq(bookings.id, bookingId));
    
    await updateEscrowContractId(result.db, bookingId, contractId, "unsigned-xdr", "deploy-tx-hash");
    await recordDeploySubmission(result.db, bookingId, contractId, "deploy-tx-hash", now - 100, now - 700);
    await updateEscrowStateSync(result.db, bookingId, "locked");
    
    await recordEscrowDisputeOpening(result.db, {
      bookingId,
      contractId,
      openedByWallet: clientWallet,
      openedByRole: "client",
      reason: "client-cancel",
      suggestedOutcome: "refund-client",
      txHash: "dispute-tx-hash",
      openedAt: now,
    });
    await result.db.update(bookings).set({
      escrowState: "disputed",
      escrowDisputeSubmittedAt: now,
      pendingDisputeOpenerWallet: clientWallet,
      pendingDisputeOpenerRole: "client",
      pendingDisputeReason: "client-cancel",
    }).where(eq(bookings.id, bookingId));

    // Try to withdraw as a different wallet
    await assert.rejects(
      () => withdrawDispute(result.db, bookingId, otherWallet, now + 10),
      UnauthorizedDisputeWithdrawalError,
    );
  } finally {
    closeDatabase(result);
  }
});

test("withdrawDispute rejects withdrawal after admin resolution", async () => {
  const result = openTestDatabase();
  try {
    const providerProfileId = await seedProviderProfile(result, { isApproved: true });
    const bookingId = await seedBooking(result, { providerProfileId });
    const contractId = fakeContractId();
    const now = Math.floor(Date.now() / 1000);
    const clientWallet = Keypair.random().publicKey();
    
    await result.db.update(bookings).set({ clientWalletAddress: clientWallet }).where(eq(bookings.id, bookingId));
    
    await updateEscrowContractId(result.db, bookingId, contractId, "unsigned-xdr", "deploy-tx-hash");
    await recordDeploySubmission(result.db, bookingId, contractId, "deploy-tx-hash", now - 100, now - 700);
    await updateEscrowStateSync(result.db, bookingId, "locked");
    
    await recordEscrowDisputeOpening(result.db, {
      bookingId,
      contractId,
      openedByWallet: clientWallet,
      openedByRole: "client",
      reason: "client-cancel",
      suggestedOutcome: "refund-client",
      txHash: "dispute-tx-hash",
      openedAt: now,
    });
    await result.db.update(bookings).set({
      escrowState: "refunded", // resolved
      escrowDisputeSubmittedAt: now,
      escrowResolveSubmittedAt: now + 50,
      pendingDisputeOpenerWallet: clientWallet,
      pendingDisputeOpenerRole: "client",
      pendingDisputeReason: "client-cancel",
    }).where(eq(bookings.id, bookingId));

    // Try to withdraw after resolution
    await assert.rejects(
      () => withdrawDispute(result.db, bookingId, clientWallet, now + 100),
      DisputeAlreadyResolvedError,
    );
  } finally {
    closeDatabase(result);
  }
});

test("withdrawDispute is idempotent for already-withdrawn dispute", async () => {
  const result = openTestDatabase();
  try {
    const providerProfileId = await seedProviderProfile(result, { isApproved: true });
    const bookingId = await seedBooking(result, { providerProfileId });
    const contractId = fakeContractId();
    const now = Math.floor(Date.now() / 1000);
    const clientWallet = Keypair.random().publicKey();
    
    await result.db.update(bookings).set({ clientWalletAddress: clientWallet }).where(eq(bookings.id, bookingId));
    
    await updateEscrowContractId(result.db, bookingId, contractId, "unsigned-xdr", "deploy-tx-hash");
    await recordDeploySubmission(result.db, bookingId, contractId, "deploy-tx-hash", now - 100, now - 700);
    await updateEscrowStateSync(result.db, bookingId, "locked");
    
    await recordEscrowDisputeOpening(result.db, {
      bookingId,
      contractId,
      openedByWallet: clientWallet,
      openedByRole: "client",
      reason: "client-cancel",
      suggestedOutcome: "refund-client",
      txHash: "dispute-tx-hash",
      openedAt: now,
    });
    await result.db.update(bookings).set({
      escrowState: "disputed",
      escrowDisputeSubmittedAt: now,
      pendingDisputeOpenerWallet: clientWallet,
      pendingDisputeOpenerRole: "client",
      pendingDisputeReason: "client-cancel",
    }).where(eq(bookings.id, bookingId));

    // First withdrawal
    await withdrawDispute(result.db, bookingId, clientWallet, now + 10);
    
    // Second withdrawal (should be a safe no-op)
    const result2 = await withdrawDispute(result.db, bookingId, clientWallet, now + 20);
    assert.equal(result2.escrowState, "locked");
    assert.equal(result2.withdrawnAt, now + 10); // Original withdrawal time preserved
  } finally {
    closeDatabase(result);
  }
});

test("withdrawDispute rejects when a resolve is already pending", async () => {
  const result = openTestDatabase();
  try {
    const providerProfileId = await seedProviderProfile(result, { isApproved: true });
    const bookingId = await seedBooking(result, { providerProfileId });
    const contractId = fakeContractId();
    const now = Math.floor(Date.now() / 1000);
    const clientWallet = Keypair.random().publicKey();
    
    await result.db.update(bookings).set({ clientWalletAddress: clientWallet }).where(eq(bookings.id, bookingId));
    
    await updateEscrowContractId(result.db, bookingId, contractId, "unsigned-xdr", "deploy-tx-hash");
    await recordDeploySubmission(result.db, bookingId, contractId, "deploy-tx-hash", now - 100, now - 700);
    await updateEscrowStateSync(result.db, bookingId, "locked");
    
    await recordEscrowDisputeOpening(result.db, {
      bookingId,
      contractId,
      openedByWallet: clientWallet,
      openedByRole: "client",
      reason: "client-cancel",
      suggestedOutcome: "refund-client",
      txHash: "dispute-tx-hash",
      openedAt: now,
    });
    await result.db.update(bookings).set({
      escrowState: "disputed",
      escrowDisputeSubmittedAt: now,
      escrowResolveSubmittedAt: now + 50, // resolve pending
      pendingDisputeOpenerWallet: clientWallet,
      pendingDisputeOpenerRole: "client",
      pendingDisputeReason: "client-cancel",
    }).where(eq(bookings.id, bookingId));

    // Try to withdraw while resolve is pending
    await assert.rejects(
      () => withdrawDispute(result.db, bookingId, clientWallet, now + 100),
      DisputeAlreadyResolvedError,
    );
  } finally {
    closeDatabase(result);
  }
});
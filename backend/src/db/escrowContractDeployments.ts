/**
 * Issue #7: one row per escrow contract id a deploy ever returned for a
 * booking. Written by `services/booking.ts`'s `lockDeposit` beside the
 * contract id it persists, read by `getBookingView` for the status panel.
 *
 * Deliberately never read by anything that moves money: settlement calls
 * (`fundDeposit`, `complete`, `approve`, `release`, `startDispute`,
 * `resolveBookingDispute`) all keep taking `bookings.escrow_contract_id`, so
 * a superseded id recorded here can be *seen* but never used.
 */
import { asc, eq } from "drizzle-orm";

import type { Db } from "./client.js";
import { escrowContractDeployments } from "./schema.js";

export interface NewContractDeployment {
  bookingId: string;
  contractId: string;
  /** UTC epoch seconds. */
  deployedAt: number;
}

export type EscrowContractDeploymentRow = typeof escrowContractDeployments.$inferSelect;

/** Records that deploy returned `contractId` for this booking. Idempotent by
 * the table's own composite key: a retried lock that re-persisted the same
 * deploy -- or a rebuild that cleared and re-deployed the identical
 * predicted id -- adds nothing, so the history stays one row per contract
 * actually built. Never touches the booking row itself. */
export async function recordContractDeployment(db: Db, values: NewContractDeployment): Promise<void> {
  await db
    .insert(escrowContractDeployments)
    .values(values)
    .onConflictDoNothing({ target: [escrowContractDeployments.bookingId, escrowContractDeployments.contractId] });
}

/** Every contract id this booking has had deployed, oldest first -- the
 * order the status panel lists them in, so the newest sits beside the
 * "active" marker at the bottom. */
export async function listContractDeployments(db: Db, bookingId: string): Promise<EscrowContractDeploymentRow[]> {
  return db
    .select()
    .from(escrowContractDeployments)
    .where(eq(escrowContractDeployments.bookingId, bookingId))
    .orderBy(asc(escrowContractDeployments.deployedAt), asc(escrowContractDeployments.contractId));
}

/**
 * Issue #5: one chain read -- "has this transaction already landed?" --
 * asked of the network itself, the same way `payments/stellar.ts` already
 * asks it for a balance payment (`Soroban RPC`'s own `getTransaction`, by
 * transaction hash).
 *
 * This lives here, next to the escrow boundary, rather than in
 * `escrow/trustless-work/`: it asks the *network*, not the vendor, so it
 * stays vendor-neutral (AD-8) -- and unlike the escrow reconciler's own
 * read, it is not a lifecycle write. Nothing in this module touches
 * `escrow_state` (AD-1): it only ever answers one question about one hash,
 * and leaves whatever the reconciler confirms to be the reconciler's own.
 */
import { rpc } from "@stellar/stellar-sdk";

import { config } from "../config.js";

/** The network could not be asked -- an unreachable endpoint, or an answer
 * that failed to parse. Deliberately *not* an "it did not land": a caller
 * deciding what to do with money must never read a missing answer as
 * permission (the same rule `services/localDeposit.ts`'s own trustline read
 * already follows). */
export class TransactionStatusUnavailableError extends Error {
  constructor(message = "The network could not be reached to check this transaction.") {
    super(message);
    this.name = "TransactionStatusUnavailableError";
  }
}

export interface TransactionStatusDeps {
  /** One `getTransaction` for one hash, returning its own status. Defaults
   * to a real Soroban RPC call; a test injects a canned answer instead and
   * never opens a socket. */
  getTransactionStatus?: (txHash: string) => Promise<rpc.Api.GetTransactionStatus>;
}

async function defaultGetTransactionStatus(txHash: string): Promise<rpc.Api.GetTransactionStatus> {
  const server = new rpc.Server(config.sorobanRpcUrl);
  const response = await server.getTransaction(txHash);
  return response.status;
}

/** `true` only when the network itself reports this transaction as settled
 * successfully -- `NOT_FOUND` (still flying) and `FAILED` both return
 * `false`, and an unreadable answer throws {@link
 * TransactionStatusUnavailableError} rather than masquerading as either. */
export async function transactionReachedSuccess(
  txHash: string,
  deps: TransactionStatusDeps = {},
): Promise<boolean> {
  const getStatus = deps.getTransactionStatus ?? defaultGetTransactionStatus;
  let status: rpc.Api.GetTransactionStatus;
  try {
    status = await getStatus(txHash);
  } catch (error) {
    if (error instanceof TransactionStatusUnavailableError) throw error;
    throw new TransactionStatusUnavailableError(
      `The network could not be reached to check transaction ${txHash}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return status === rpc.Api.GetTransactionStatus.SUCCESS;
}

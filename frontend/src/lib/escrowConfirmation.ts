/**
 * What the pre-signature confirmation shows about the escrow the client is
 * about to fund. Kept free of React so the two states -- the contract id,
 * or `ESCROW_UNAVAILABLE` with no id -- can be asserted without a DOM.
 */

export const ESCROW_UNAVAILABLE_CODE = "ESCROW_UNAVAILABLE";

export type EscrowConfirmationView =
  | { kind: "ready"; contractId: string }
  | { kind: "unavailable"; code: typeof ESCROW_UNAVAILABLE_CODE };

/** The id is only ever shown when the server returned one; any missing id
 * (operator not configured, deploy never built) is the unavailable state. */
export function describeEscrowConfirmation(contractId: string | undefined): EscrowConfirmationView {
  return contractId
    ? { kind: "ready", contractId }
    : { kind: "unavailable", code: ESCROW_UNAVAILABLE_CODE };
}

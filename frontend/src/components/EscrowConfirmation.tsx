import { useState } from "react";

import { describeEscrowConfirmation } from "../lib/escrowConfirmation";

export interface EscrowConfirmationProps {
  /** The escrow contract id that will be stored for this booking; `undefined`
   * when the escrow operator is not configured. */
  contractId?: string;
  /** Message sent with the `ESCROW_UNAVAILABLE` state. */
  unavailableMessage?: string;
  /** Proceeds to the wallet signature for the escrow shown. */
  onConfirm?: () => void;
  /** Leaves without signing. The stored escrow is reused next time -- a
   * second one is never deployed. */
  onCancel?: () => void;
}

/**
 * The step before signing: names the escrow the client is about to fund
 * (copyable), or says `ESCROW_UNAVAILABLE` when there is none to name.
 */
export function EscrowConfirmation({ contractId, unavailableMessage, onConfirm, onCancel }: EscrowConfirmationProps) {
  const view = describeEscrowConfirmation(contractId);
  const [copied, setCopied] = useState(false);

  if (view.kind === "unavailable") {
    return (
      <div className="escrow-confirmation" role="alert">
        <p className="escrow-confirmation__title">{view.code}</p>
        <p className="escrow-confirmation__text">{unavailableMessage ?? "Your deposit is untouched."}</p>
      </div>
    );
  }

  async function copyContractId() {
    try {
      await navigator.clipboard.writeText(contractId ?? "");
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="escrow-confirmation" role="group" aria-label="Confirm your escrow">
      <p className="escrow-confirmation__title">You are about to fund this escrow</p>
      <code className="escrow-confirmation__id">{view.contractId}</code>
      <button type="button" className="button-ghost escrow-confirmation__copy" onClick={() => void copyContractId()} aria-live="polite">
        {copied ? "Copied" : "Copy escrow ID"}
      </button>
      <button type="button" className="button-escrow" onClick={() => onConfirm?.()}>
        Confirm and sign
      </button>
      <button type="button" className="button-ghost escrow-confirmation__cancel" onClick={() => onCancel?.()}>
        Cancel
      </button>
    </div>
  );
}

import { useState } from "react";

import { truncateWalletAddress } from "../lib/walletConfirmation";

interface WalletAddressConfirmProps {
  address: string;
  title?: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function WalletAddressConfirm({
  address,
  title = "Confirm the wallet that will sign",
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: WalletAddressConfirmProps) {
  const [showFullAddress, setShowFullAddress] = useState(false);

  return (
    <div className="wallet-address-confirm" role="dialog" aria-modal="true" aria-label={title}>
      <p className="wallet-address-confirm__title">{title}</p>
      <p className="wallet-address-confirm__address tabular-nums">
        {showFullAddress ? address : truncateWalletAddress(address)}
      </p>
      <button
        type="button"
        className="button-ghost wallet-address-confirm__show"
        onClick={() => setShowFullAddress((shown) => !shown)}
      >
        {showFullAddress ? "Hide full address" : "Show full address"}
      </button>
      <div className="booking-card__actions">
        <button type="button" className="button-primary" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="button-ghost" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}

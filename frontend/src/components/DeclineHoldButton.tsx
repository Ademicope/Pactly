import { useState } from "react";

import { ApiError } from "../api/client";
import { declineHold } from "../api/hooks";
import type { Session } from "../wallet";

export interface DeclineHoldButtonProps {
  id: string;
  session?: Session;
  /** Called once the hold was declined, or was already moved on by someone else. */
  onDeclined?: () => unknown;
  /** A 401 from the decline call. */
  onUnauthorized?: () => void;
}

/**
 * The shop's "Decline hold" action for an unlocked hold on its own slot. Two
 * steps (button, then confirm) so a hold is never turned away by a stray tap.
 */
export function DeclineHoldButton({ id, session, onDeclined, onUnauthorized }: DeclineHoldButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  async function handleDecline(): Promise<void> {
    if (!session || busy) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await declineHold(id, session);
      setConfirming(false);
      await onDeclined?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized?.();
      } else if (error instanceof ApiError && error.code === "BOOKING_STATE") {
        setConfirming(false);
        setNotice("This booking has already moved on -- refresh to see its current state.");
        await onDeclined?.();
      } else {
        setNotice(error instanceof ApiError ? error.message : "Connection dropped. Nothing changed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="booking-card__actions">
      {!confirming ? (
        <button type="button" className="button-ghost" disabled={busy} onClick={() => setConfirming(true)}>
          Decline hold
        </button>
      ) : (
        <div className="booking-card__dispute-panel">
          <p>Decline this hold? The slot opens up again and the client is told it was declined.</p>
          <div className="booking-card__actions">
            <button type="button" className="button-primary" disabled={busy} onClick={() => void handleDecline()}>
              {busy ? "Declining…" : "Confirm, decline hold"}
            </button>
            <button type="button" className="button-ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Never mind
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p className="booking-card__notice booking-card__notice--alert" aria-live="polite">
          {notice}
        </p>
      )}
    </div>
  );
}

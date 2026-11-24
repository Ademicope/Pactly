import type { ReactNode } from "react";

import { shortenStellarId, stellarExplorerContractUrl, trustlessWorkViewerUrl } from "../lib/stellar";
import { EscrowProof } from "./EscrowProof";
import { TryAmount } from "./TryAmount";

/** Issue #7: one escrow this booking has had deployed for it, with the one
 * its deposit currently settles against marked. Mirrors `BookingView`'s own
 * `contractHistory`. */
export interface EscrowHistoryEntry {
  contractId: string;
  active: boolean;
}

export interface EscrowLaneProps {
  /** Integer string, USDC smallest units (AD-7) -- shown in TRY. */
  depositAmount: string;
  /** `undefined` before a hold exists. */
  holdCountdownLabel?: string;
  contractId?: string;
  txHash?: string;
  /** Review follow-up: the escrow proof line is evidence for a *confirmed*
   * lock, not a preview of a deploy still in flight -- callers pass `true`
   * only once the booking has actually reconciled to `locked`, never
   * merely because a `contractId` happens to exist yet (a deploy can be
   * built, or even abandoned and rebuilt, long before that). */
  showProof: boolean;
  /** A short, plain-language state label -- text always accompanies the
   * lane's colour (DESIGN.md Accessibility Floor: "state never conveyed by
   * colour alone"). */
  stateLabel: string;
  /** Issue #5: the lane's second fact, rendered as its own line beneath
   * `stateLabel` rather than folded into it with a separator -- "an escrow
   * was created" and "your deposit is not in it yet" are two things the
   * client has to read separately, and only the second one is what
   * "Continue funding" is about. */
  stateDetail?: string;
  /** Issue #7: every escrow this booking has had deployed, oldest first.
   * Empty (the common case) renders nothing at all. */
  contractHistory?: EscrowHistoryEntry[];
  children?: ReactNode;
}

/**
 * DESIGN.md's `band-escrow`: the black column between the client and
 * provider lanes (or, below 1024px, the bar pinned to the bottom -- see
 * `base.css`'s own responsive rule). Holds the lock icon, the deposit
 * amount, the hold countdown while one is running, the escrows this
 * booking has had, and the escrow proof once the booking is actually
 * locked. Never itself interactive except for the "Lock with Pactly"
 * button, which `BookingPage.tsx` passes in as `children` so this component
 * stays a pure display of state.
 */
export function EscrowLane({
  depositAmount,
  holdCountdownLabel,
  contractId,
  txHash,
  showProof,
  stateLabel,
  stateDetail,
  contractHistory,
  children,
}: EscrowLaneProps) {
  return (
    <div className="escrow-lane">
      <p className="escrow-lane__label">ESCROW LANE</p>
      <div className="escrow-lane__lock" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </div>
      <div className="escrow-lane__amount tabular-nums">
        <TryAmount amount={depositAmount} />
      </div>
      <p className="escrow-lane__state" aria-live="polite">
        {stateLabel}
      </p>
      {stateDetail && (
        <p className="escrow-lane__state-detail" aria-live="polite">
          {stateDetail}
        </p>
      )}
      {holdCountdownLabel && (
        <p className="escrow-lane__countdown tabular-nums" aria-live="polite">
          Slot held for {holdCountdownLabel}
        </p>
      )}
      {children}
      {contractHistory && contractHistory.length > 0 && (
        <div className="escrow-proof escrow-history">
          <span>ESCROWS THIS BOOKING HAS HAD</span>
          {contractHistory.map((entry) => (
            <p className="escrow-history__entry" key={entry.contractId}>
              <span className="tabular-nums">{shortenStellarId(entry.contractId)}</span>
              {entry.active && <b> current</b>}
              <a href={stellarExplorerContractUrl(entry.contractId)} target="_blank" rel="noreferrer">
                View escrow record &#8599;
              </a>
              <a href={trustlessWorkViewerUrl(entry.contractId)} target="_blank" rel="noreferrer">
                View in Escrow Viewer &#8599;
              </a>
            </p>
          ))}
        </div>
      )}
      {showProof && (contractId || txHash) && <EscrowProof contractId={contractId} txHash={txHash} />}
    </div>
  );
}

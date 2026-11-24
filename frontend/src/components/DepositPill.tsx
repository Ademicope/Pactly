import { TryAmount } from "./TryAmount";

export interface DepositPillProps {
  /** Integer string, USDC smallest units (AD-7) -- shown in TRY. */
  amount: string;
  cancellationWindowHours: number;
  /** When set, show the shop's deposit percent of the session price. */
  depositRateBps?: number;
  /** Review follow-up: `true` only once a real hold's own `cancelDeadline`
   * has already passed -- overrides the generic window label with the
   * fact that free cancellation is no longer available for *this*
   * booking, rather than repeating a policy statement that no longer
   * applies to it. */
  freeCancellationEnded?: boolean;
  /** `"pill"` (default) is `editorial-v1.html`'s own black `.pill` -- the
   * provider profile aside and the booking lane, wherever the deposit
   * needs the escrow's own weight. `"row"` is its plain in-row `.dep`:
   * the provider list row's own price rail, which never puts a black
   * block inside a hairline-separated row. Both always pair the amount
   * with the free-cancellation window (the spec's own "Always" rule). */
  variant?: "pill" | "row";
}

function rateCaption(depositRateBps: number | undefined): string | undefined {
  if (depositRateBps === undefined || !Number.isFinite(depositRateBps)) {
    return undefined;
  }
  const percent = depositRateBps / 100;
  const label = Number.isInteger(percent) ? String(percent) : percent.toFixed(2);
  return `${label}% of price`;
}

/** DESIGN.md's `pill-deposit` -- amount and free-cancellation window
 * together, always. */
export function DepositPill({
  amount,
  cancellationWindowHours,
  depositRateBps,
  freeCancellationEnded,
  variant = "pill",
}: DepositPillProps) {
  const windowLabel = freeCancellationEnded
    ? "free-cancellation window has passed"
    : cancellationWindowHours === 0
      ? "no free cancellation"
      : `full refund up to ${cancellationWindowHours}h before`;
  const rateLabel = rateCaption(depositRateBps);
  const caption = rateLabel ? `${rateLabel} · ${windowLabel}` : windowLabel;

  if (variant === "row") {
    return (
      <p className="deposit-row tabular-nums">
        <b className="deposit-row__amount">
          <TryAmount amount={amount} />
        </b>{" "}
        deposit
        <span className="deposit-row__caption"> · {caption}</span>
      </p>
    );
  }

  return (
    <p className="deposit-pill tabular-nums">
      <b className="deposit-pill__amount">
        <TryAmount amount={amount} />
      </b>{" "}
      deposit
      <span className="deposit-pill__caption">{caption}</span>
    </p>
  );
}

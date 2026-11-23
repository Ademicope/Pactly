import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { submitShopReport, usePublicProviderProfile } from "../../api/hooks";
import { ApiError } from "../../api/client";
import { DepositPill } from "../../components/DepositPill";
import { ProviderHeader } from "../../components/ProviderHeader";
import { SlotChip } from "../../components/SlotChip";
import { TryAmount } from "../../components/TryAmount";
import { providerPhotoSrc } from "../../lib/providerPhotos";
import { formatSessionFormat } from "../../lib/sessionFormat";
import { groupSlotsByDay } from "../../lib/time";
import { getSession, type Session } from "../../wallet";

/** `/providers/:id` -- a public profile, no sign-in required
 * (EXPERIENCE.md: "Discovery, search, profile viewing ... need no
 * sign-in"). No booking action lives here yet (Story 3.4's job) -- picking
 * a slot only ever highlights it locally. */
export function ProviderProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: profile, isLoading, error } = usePublicProviderProfile(id);
  
  const [session] = useState<Session | undefined>(() => getSession());
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportNotice, setReportNotice] = useState<{ text: string; isError: boolean } | undefined>();

  // `?slot=<epochSeconds>` pre-selects that slot when it matches an open
  // one; any other value (unknown, stale, malformed) is silently ignored
  // (the spec's own "Slot pre-selection" row).
  const requestedSlot = searchParams.get("slot");
  const selectedSlot = useMemo(() => {
    if (!requestedSlot || !profile) {
      return undefined;
    }
    const parsed = Number(requestedSlot);
    return profile.slots.includes(parsed) ? parsed : undefined;
  }, [requestedSlot, profile]);

  function selectSlot(startsAt: number): void {
    const next = new URLSearchParams(searchParams);
    next.set("slot", String(startsAt));
    setSearchParams(next, { replace: true });
  }

  async function handleReportSubmit(): Promise<void> {
    if (!session || !id) return;
    
    setReportSubmitting(true);
    setReportNotice(undefined);
    
    try {
      await submitShopReport(id, reportReason, session);
      setReportNotice({ text: "Report submitted. Admins will review it.", isError: false });
      setReportReason("");
      setTimeout(() => {
        setShowReportDialog(false);
        setReportNotice(undefined);
      }, 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "RATE_LIMIT") {
          setReportNotice({ text: "You've already reported this shop recently. Try again later.", isError: true });
        } else if (err.code === "INVALID_REASON") {
          setReportNotice({ text: "Report reason cannot be empty and must be 500 characters or less.", isError: true });
        } else if (err.code === "SHOP_NOT_FOUND") {
          setReportNotice({ text: "This shop is no longer available.", isError: true });
        } else {
          setReportNotice({ text: "Something went wrong. Try again.", isError: true });
        }
      } else {
        setReportNotice({ text: "Connection dropped. Try again.", isError: true });
      }
    } finally {
      setReportSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="page">
        <p>Loading this provider…</p>
      </div>
    );
  }

  if (error) {
    const notFound = error instanceof ApiError && error.code === "PROVIDER_NOT_FOUND";
    return (
      <div className="page">
        <div className="banner banner--alert">
          <p>{notFound ? "This provider isn't available." : "Connection dropped. Try again."}</p>
        </div>
        <p>
          <Link to="/discover">Back to Discover</Link>
        </p>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  const dayGroups = groupSlotsByDay(profile.slots);
  
  const canReport = session && profile.isApproved;

  return (
    <div className="page">
      <ProviderHeader
        displayName={profile.displayName}
        title={profile.title}
        location={profile.location}
        categoryName={profile.category.name}
        isApproved={profile.isApproved}
        verifiedSessionCount={profile.verifiedSessionCount}
        photoSrc={providerPhotoSrc(profile.id)}
      />

      {canReport && (
        <div style={{ marginTop: "var(--space-4)" }}>
          <button
            type="button"
            className="button-secondary"
            onClick={() => setShowReportDialog(true)}
            style={{ fontSize: "var(--text-14)" }}
          >
            Report this shop
          </button>
        </div>
      )}

      <div className="card" style={{ marginTop: "var(--space-6)" }}>
        {profile.bio && (
          <div style={{ marginBottom: "var(--space-5)" }}>
            <h2 style={{ fontSize: "var(--text-18)" }}>About this shop</h2>
            <p>{profile.bio}</p>
          </div>
        )}
        {profile.languages.length > 0 && (
          <p style={{ marginBottom: "var(--space-5)" }}>Languages: {profile.languages.join(", ")}</p>
        )}
        <div className="price-row">
          <TryAmount amount={profile.price.amount} className="price-row__amount" />
          <span className="price-row__meta">
            {formatSessionFormat(profile.sessionFormat)} · {profile.sessionLengthMinutes} min
          </span>
        </div>

        <div style={{ marginTop: "var(--space-4)" }}>
          <DepositPill amount={profile.deposit.amount} cancellationWindowHours={profile.cancellationWindowHours} />
        </div>

        <div style={{ marginTop: "var(--space-6)" }}>
          <h2 style={{ fontSize: "var(--text-18)" }}>Upcoming slots</h2>
          {dayGroups.length === 0 ? (
            <p className="banner">No open slots in the next 30 days. Check back soon.</p>
          ) : (
            dayGroups.map((group) => (
              <div className="slot-day" key={group.dayLabel}>
                <div className="slot-day__label">{group.dayLabel}</div>
                <div className="slot-day__chips">
                  {group.slots.map((startsAt) => (
                    <SlotChip key={startsAt} startsAt={startsAt} selected={startsAt === selectedSlot} onSelect={selectSlot} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {selectedSlot !== undefined && (
          <div style={{ marginTop: "var(--space-6)" }}>
            <Link to={`/book/${profile.id}?slot=${selectedSlot}`} className="button-primary" style={{ textDecoration: "none" }}>
              Continue
            </Link>
          </div>
        )}
      </div>

      {showReportDialog && (
        <div className="modal-overlay" onClick={() => setShowReportDialog(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: "var(--space-4)" }}>Report this shop</h2>
            <p style={{ marginBottom: "var(--space-4)", color: "var(--color-text-secondary)" }}>
              Tell admins why this listing should be reviewed. This is not a dispute on a booking.
            </p>
            
            {reportNotice && (
              <div className={reportNotice.isError ? "banner banner--alert" : "banner"} style={{ marginBottom: "var(--space-4)" }}>
                <p>{reportNotice.text}</p>
              </div>
            )}
            
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Describe the issue (max 500 characters)"
              maxLength={500}
              rows={5}
              style={{
                width: "100%",
                padding: "var(--space-3)",
                fontSize: "var(--text-16)",
                fontFamily: "inherit",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-2)",
                marginBottom: "var(--space-2)",
              }}
              disabled={reportSubmitting}
            />
            
            <p style={{ fontSize: "var(--text-14)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
              {reportReason.length}/500 characters
            </p>
            
            <div style={{ display: "flex", gap: "var(--space-3)" }}>
              <button
                type="button"
                className="button-primary"
                onClick={handleReportSubmit}
                disabled={reportSubmitting || reportReason.trim().length === 0}
              >
                {reportSubmitting ? "Submitting…" : "Submit report"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setShowReportDialog(false);
                  setReportNotice(undefined);
                }}
                disabled={reportSubmitting}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

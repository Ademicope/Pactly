import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { saveShop, unsaveShop, useIsShopSaved, usePublicProviderProfile } from "../../api/hooks";
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
  const { data: savedData, refetch: refetchSaved } = useIsShopSaved(id, session);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "unsaving">("idle");
  const [saveNotice, setSaveNotice] = useState<string | undefined>();

  const isSaved = savedData?.isSaved ?? false;

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

  async function handleSaveToggle(): Promise<void> {
    if (!session || !id) return;

    setSavingState(isSaved ? "unsaving" : "saving");
    setSaveNotice(undefined);

    try {
      if (isSaved) {
        await unsaveShop(id, session.token);
        setSaveNotice("Removed from saved shops");
      } else {
        await saveShop(id, session.token);
        setSaveNotice("Saved!");
      }
      await refetchSaved();
      setTimeout(() => setSaveNotice(undefined), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "SHOP_NOT_APPROVED") {
          setSaveNotice("This shop is not taking bookings");
        } else {
          setSaveNotice("Something went wrong");
        }
      } else {
        setSaveNotice("Connection dropped. Try again.");
      }
    } finally {
      setSavingState("idle");
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
  
  const canSave = session && profile.isApproved;

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

      {canSave && (
        <div style={{ marginTop: "var(--space-4)", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <button
            type="button"
            className="button-secondary"
            onClick={handleSaveToggle}
            disabled={savingState !== "idle"}
            style={{ fontSize: "var(--text-14)" }}
          >
            {savingState === "saving" && "Saving..."}
            {savingState === "unsaving" && "Removing..."}
            {savingState === "idle" && (isSaved ? "★ Saved" : "☆ Save shop")}
          </button>
          {saveNotice && <span style={{ fontSize: "var(--text-14)", color: "var(--color-text-secondary)" }}>{saveNotice}</span>}
        </div>
      )}

      <div className="card" style={{ marginTop: "var(--space-6)" }}>
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
    </div>
  );
}

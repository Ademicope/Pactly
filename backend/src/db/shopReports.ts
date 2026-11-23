/**
 * Database functions for shop reports.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "./client.js";
import { shopReports, providerProfiles } from "./schema.js";

export interface NewShopReport {
  id: string;
  providerProfileId: string;
  reportedByWallet: string;
  reason: string;
  createdAt: number;
}

export async function insertShopReport(db: Db, report: NewShopReport): Promise<void> {
  await db.insert(shopReports).values(report);
}

/**
 * Checks if the client has already reported this shop within the last 24 hours.
 * Returns true if a report exists, false otherwise.
 */
export async function hasReportedShopRecently(
  db: Db,
  providerProfileId: string,
  reportedByWallet: string,
  now: number,
): Promise<boolean> {
  const oneDayAgo = now - 24 * 60 * 60;
  const rows = await db
    .select({ id: shopReports.id })
    .from(shopReports)
    .where(
      and(
        eq(shopReports.providerProfileId, providerProfileId),
        eq(shopReports.reportedByWallet, reportedByWallet),
        gte(shopReports.createdAt, oneDayAgo),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface ShopReportWithProvider {
  report: typeof shopReports.$inferSelect;
  provider: {
    id: string;
    displayName: string;
    walletAddress: string;
    isApproved: boolean;
  };
}

/**
 * Lists all shop reports, newest first, with provider details.
 * Admin-only view.
 */
export async function listShopReports(db: Db): Promise<ShopReportWithProvider[]> {
  const rows = await db
    .select({
      report: shopReports,
      provider: {
        id: providerProfiles.id,
        displayName: providerProfiles.displayName,
        walletAddress: providerProfiles.walletAddress,
        isApproved: providerProfiles.isApproved,
      },
    })
    .from(shopReports)
    .innerJoin(providerProfiles, eq(shopReports.providerProfileId, providerProfiles.id))
    .orderBy(desc(shopReports.createdAt));
  
  return rows;
}

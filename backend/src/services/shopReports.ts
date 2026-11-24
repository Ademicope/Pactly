/**
 * Service functions for shop reports.
 */
import { randomBytes } from "node:crypto";
import type { Db } from "../db/client.js";
import { getProviderProfileById } from "../db/providerProfiles.js";
import { hasReportedShopRecently, insertShopReport, listShopReports } from "../db/shopReports.js";

export class ShopNotFoundError extends Error {
  constructor(message = "No shop was found with that id.") {
    super(message);
    this.name = "ShopNotFoundError";
  }
}

export class InvalidReportReasonError extends Error {
  constructor(message = "Report reason cannot be empty and must be 500 characters or less.") {
    super(message);
    this.name = "InvalidReportReasonError";
  }
}

export class ReportRateLimitError extends Error {
  constructor(message = "You've already reported this shop recently. Try again later.") {
    super(message);
    this.name = "ReportRateLimitError";
  }
}

function generateReportId(): string {
  return randomBytes(16).toString("hex");
}

export interface SubmitShopReportInput {
  providerProfileId: string;
  reportedByWallet: string;
  reason: string;
}

/**
 * Submits a shop report from a signed-in client.
 * - Validates the shop exists and is approved
 * - Validates reason is non-empty and <= 500 characters
 * - Rate limits to once per day per client per shop
 * - Does not change the shop's status
 */
export async function submitShopReport(db: Db, input: SubmitShopReportInput, now: number): Promise<{ reportId: string }> {
  // Validate reason
  const trimmedReason = input.reason.trim();
  if (trimmedReason.length === 0 || trimmedReason.length > 500) {
    throw new InvalidReportReasonError();
  }

  // Validate shop exists and is approved
  const provider = await getProviderProfileById(db, input.providerProfileId);
  if (!provider || !provider.isApproved) {
    throw new ShopNotFoundError();
  }

  // Check rate limit
  const hasReported = await hasReportedShopRecently(db, input.providerProfileId, input.reportedByWallet, now);
  if (hasReported) {
    throw new ReportRateLimitError();
  }

  // Insert report
  const reportId = generateReportId();
  await insertShopReport(db, {
    id: reportId,
    providerProfileId: input.providerProfileId,
    reportedByWallet: input.reportedByWallet,
    reason: trimmedReason,
    createdAt: now,
  });

  return { reportId };
}

export interface ShopReportListItem {
  id: string;
  reason: string;
  createdAt: number;
  reportedByWallet: string;
  provider: {
    id: string;
    displayName: string;
    walletAddress: string;
    isApproved: boolean;
  };
}

/**
 * Lists all shop reports for admin view, newest first.
 */
export async function getShopReportsForAdmin(db: Db): Promise<ShopReportListItem[]> {
  const reports = await listShopReports(db);
  return reports.map((r) => ({
    id: r.report.id,
    reason: r.report.reason,
    createdAt: r.report.createdAt,
    reportedByWallet: r.report.reportedByWallet,
    provider: r.provider,
  }));
}

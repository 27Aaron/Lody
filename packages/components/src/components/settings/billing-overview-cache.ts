import { z } from 'zod';
import { createLocalStorageCache } from '@/lib/local-storage-cache';
import type { BillingOverviewData } from './billing-setting-pure';

const billingOverviewSchema: z.ZodType<BillingOverviewData> = z.object({
  billingAccountId: z.string().nullable(),
  effectivePlanTier: z.enum(['free', 'plus', 'enterprise']),
  entitlementSource: z.enum(['free', 'stripe', 'stripe_gift', 'enterprise']),
  offerKey: z.string().nullable(),
  yearlyEarlyBirdEligible: z.boolean(),
  promotionalEntitlementEndsAt: z.number().nullable(),
  checkoutPending: z.boolean(),
  checkoutInterval: z.enum(['month', 'year']).nullable(),
  subscriptionStatus: z.string().nullable(),
  billingInterval: z.enum(['month', 'year']).nullable(),
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodEnd: z.number().nullable(),
  seatCount: z.number(),
  canManageBilling: z.boolean(),
  pricing: z.object({
    monthlyAmountCents: z.number(),
    yearlyAmountCents: z.number(),
    monthlyOfferKey: z.string().nullable(),
    yearlyOfferKey: z.string().nullable(),
  }),
});

const billingOverviewCacheEntrySchema = z.object({
  authSessionId: z.string(),
  overview: billingOverviewSchema,
});

const billingOverviewCache = createLocalStorageCache(
  'lody:billingOverview',
  billingOverviewCacheEntrySchema
);

/**
 * First-visit fallback. Billing mutations remain disabled until the server has
 * confirmed the viewer's role; the live query replaces these conservative
 * values as soon as it resolves.
 */
export const OPTIMISTIC_BILLING_OVERVIEW: BillingOverviewData = {
  billingAccountId: null,
  effectivePlanTier: 'free',
  entitlementSource: 'free',
  offerKey: null,
  yearlyEarlyBirdEligible: false,
  promotionalEntitlementEndsAt: null,
  checkoutPending: false,
  checkoutInterval: null,
  subscriptionStatus: null,
  billingInterval: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  seatCount: 1,
  canManageBilling: false,
  pricing: {
    monthlyAmountCents: 1000,
    yearlyAmountCents: 9600,
    monthlyOfferKey: null,
    yearlyOfferKey: null,
  },
};

export function readBillingOverviewCache(
  workspaceId: string,
  authSessionId: string | null
): BillingOverviewData | null {
  if (!authSessionId) return null;
  const entry = billingOverviewCache.get(workspaceId);
  return entry?.authSessionId === authSessionId ? entry.overview : null;
}

export function writeBillingOverviewCache(
  workspaceId: string,
  authSessionId: string,
  overview: BillingOverviewData
): void {
  billingOverviewCache.set(workspaceId, { authSessionId, overview });
}

export function clearBillingOverviewCache(workspaceId: string): void {
  billingOverviewCache.remove(workspaceId);
}

export function areBillingOverviewsEqual(
  left: BillingOverviewData | null,
  right: BillingOverviewData | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;

  return (
    left.billingAccountId === right.billingAccountId &&
    left.effectivePlanTier === right.effectivePlanTier &&
    left.entitlementSource === right.entitlementSource &&
    left.offerKey === right.offerKey &&
    left.yearlyEarlyBirdEligible === right.yearlyEarlyBirdEligible &&
    left.promotionalEntitlementEndsAt === right.promotionalEntitlementEndsAt &&
    left.checkoutPending === right.checkoutPending &&
    left.checkoutInterval === right.checkoutInterval &&
    left.subscriptionStatus === right.subscriptionStatus &&
    left.billingInterval === right.billingInterval &&
    left.cancelAtPeriodEnd === right.cancelAtPeriodEnd &&
    left.currentPeriodEnd === right.currentPeriodEnd &&
    left.seatCount === right.seatCount &&
    left.canManageBilling === right.canManageBilling &&
    left.pricing.monthlyAmountCents === right.pricing.monthlyAmountCents &&
    left.pricing.yearlyAmountCents === right.pricing.yearlyAmountCents &&
    left.pricing.monthlyOfferKey === right.pricing.monthlyOfferKey &&
    left.pricing.yearlyOfferKey === right.pricing.yearlyOfferKey
  );
}

/** Keep the displayed object stable when a refreshed query is semantically unchanged. */
export function reconcileBillingOverview(
  current: BillingOverviewData | null,
  fetched: BillingOverviewData | null
): BillingOverviewData | null {
  return areBillingOverviewsEqual(current, fetched) ? current : fetched;
}

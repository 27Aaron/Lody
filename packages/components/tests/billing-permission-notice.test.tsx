// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

import {
  BillingSettingsView,
  type BillingOverviewData,
  type BillingSettingsViewProps,
} from '../src/components/settings/billing-setting-pure';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const freeOverview: BillingOverviewData = {
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
  seatCount: 3,
  canManageBilling: true,
  pricing: {
    monthlyAmountCents: 1000,
    yearlyAmountCents: 9600,
    monthlyOfferKey: null,
    yearlyOfferKey: null,
  },
};

describe('BillingSettingsView upgrade permission', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    root = undefined;
    container?.remove();
    container = undefined;
  });

  async function renderView(overrides: Partial<BillingSettingsViewProps>) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const props: BillingSettingsViewProps = {
      overview: freeOverview,
      sessionCount: 2,
      interval: 'year',
      pendingAction: null,
      redeemPending: false,
      cancelPending: false,
      invoices: undefined,
      invoicesError: false,
      paymentProcessing: false,
      onIntervalChange: () => {},
      onUpgrade: () => {},
      onSwitchInterval: () => {},
      switchIntervalPending: false,
      onCancelSubscription: () => {},
      onResumeSubscription: () => {},
      onRedeemCode: () => {},
      onRetryInvoices: () => {},
      ...overrides,
    };

    await act(async () => {
      root?.render(createElement(BillingSettingsView, props));
    });
  }

  function upgradeButton(): HTMLButtonElement | undefined {
    return Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Upgrade now')
    ) as HTMLButtonElement | undefined;
  }

  it('offers the upgrade action to a viewer who can manage billing', async () => {
    await renderView({});

    expect(upgradeButton()?.disabled).toBe(false);
    expect(container?.textContent).not.toContain("You can't upgrade this workspace");
  });

  it('explains why a member cannot upgrade and who to ask', async () => {
    await renderView({
      overview: { ...freeOverview, canManageBilling: false },
      workspaceOwnerName: 'Ada Lovelace',
    });

    expect(upgradeButton()).toBeUndefined();
    expect(container?.textContent).toContain("You can't upgrade this workspace");
    expect(container?.textContent).toContain('Ask Ada Lovelace to upgrade this workspace.');
  });

  it('falls back to the generic reason when the owner is unknown', async () => {
    await renderView({
      overview: { ...freeOverview, canManageBilling: false },
      workspaceOwnerName: null,
    });

    expect(container?.textContent).toContain("You can't upgrade this workspace");
    expect(container?.textContent).toContain(
      'Only workspace owners and admins can manage billing.'
    );
  });

  it('keeps the action disabled instead of denying permission before the role is known', async () => {
    await renderView({
      overview: { ...freeOverview, canManageBilling: false },
      canManageBillingKnown: false,
    });

    expect(upgradeButton()?.disabled).toBe(true);
    expect(container?.textContent).not.toContain("You can't upgrade this workspace");
  });
});

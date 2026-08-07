import { createFileRoute } from '@tanstack/react-router';
import { pricingHead, PricingRoutePage } from '@site/src/site-pages';

export const Route = createFileRoute('/price')({
  head: () => pricingHead('en'),
  component: () => <PricingRoutePage locale="en" />,
});

import { createFileRoute } from '@tanstack/react-router';
import { pricingHead, PricingRoutePage } from '@site/src/site-pages';

export const Route = createFileRoute('/zh/price')({
  head: () => pricingHead('zh'),
  component: () => <PricingRoutePage locale="zh" />,
});

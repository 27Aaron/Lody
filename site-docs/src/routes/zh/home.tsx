import { landingHead, LandingRoutePage } from '@site/src/site-pages';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/zh/home')({
  head: () => landingHead('zh', { noindex: true }),
  component: () => <LandingRoutePage locale="zh" />,
});

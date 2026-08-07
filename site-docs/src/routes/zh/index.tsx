import { landingHead, LandingRoutePage } from '@site/src/site-pages';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/zh/')({
  head: () => landingHead('zh'),
  component: () => <LandingRoutePage locale="zh" />,
});

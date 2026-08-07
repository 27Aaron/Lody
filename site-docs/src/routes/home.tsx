import { landingHead, LandingRoutePage } from '@site/src/site-pages';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/home')({
  head: () => landingHead('en', { noindex: true }),
  component: () => <LandingRoutePage locale="en" />,
});

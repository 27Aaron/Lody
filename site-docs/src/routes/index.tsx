import { landingHead, LandingRoutePage } from '@site/src/site-pages';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  head: () => landingHead('en'),
  component: () => <LandingRoutePage locale="en" />,
});

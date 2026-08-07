import { preloadLegalPageContent } from '@site/components/legal-page';
import { loadLegalPageRoute } from '@site/src/pages-loader';
import { legalPageHead, LegalRoutePage } from '@site/src/site-pages';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/terms')({
  loader: async () => {
    const data = await loadLegalPageRoute({ data: { locale: 'en', slug: 'terms' } });
    await preloadLegalPageContent('en', data.docPath);
    return data;
  },
  head: ({ loaderData }) =>
    loaderData ? legalPageHead('en', loaderData) : { meta: [{ title: 'Terms of Service' }] },
  component: TermsPage,
});

function TermsPage() {
  const data = Route.useLoaderData();
  return <LegalRoutePage entry={data} locale="en" />;
}

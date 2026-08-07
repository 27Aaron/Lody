import { preloadBlogContent } from '@site/components/blog';
import { loadBlogPostRoute } from '@site/src/blog-loader';
import { blogIndexHead, blogPostHead, BlogPostRoutePage } from '@site/src/site-pages';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/blog/$')({
  loader: async ({ params }) => {
    const data = await loadBlogPostRoute({ data: { locale: 'en', splat: params._splat } });
    await preloadBlogContent('en', data.docPath);

    return data;
  },
  head: ({ loaderData }) => (loaderData ? blogPostHead('en', loaderData) : blogIndexHead('en')),
  component: BlogPost,
});

function BlogPost() {
  const data = Route.useLoaderData();

  return <BlogPostRoutePage entry={data} locale="en" />;
}

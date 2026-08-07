import { preloadBlogContent } from '@site/components/blog';
import { loadBlogPostRoute } from '@site/src/blog-loader';
import { blogIndexHead, blogPostHead, BlogPostRoutePage } from '@site/src/site-pages';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/zh/blog/$')({
  loader: async ({ params }) => {
    const data = await loadBlogPostRoute({ data: { locale: 'zh', splat: params._splat } });
    await preloadBlogContent('zh', data.docPath);

    return data;
  },
  head: ({ loaderData }) => (loaderData ? blogPostHead('zh', loaderData) : blogIndexHead('zh')),
  component: BlogPost,
});

function BlogPost() {
  const data = Route.useLoaderData();

  return <BlogPostRoutePage entry={data} locale="zh" />;
}

import type { BlogEntry, BlogLocale } from '@site/lib/blog';
import { createServerFn } from '@tanstack/react-start';
import { notFound } from '@tanstack/react-router';
import { staticFunctionMiddleware } from '@tanstack/start-static-server-functions';

type BlogLocaleInput = {
  locale: BlogLocale;
};

type BlogPostInput = BlogLocaleInput & {
  splat?: string;
};

function slugFromSplat(splat: string | undefined): string[] | undefined {
  const segments = splat?.split('/').filter((segment) => segment.length > 0) ?? [];
  return segments.length > 0 ? segments : undefined;
}

export const loadBlogIndexRoute = createServerFn({ method: 'GET' })
  .middleware([staticFunctionMiddleware])
  .validator((input: BlogLocaleInput) => input)
  .handler(async ({ data }): Promise<BlogEntry[]> => {
    const { getBlogEntries } = await import('@site/lib/blog.server');

    return getBlogEntries(data.locale);
  });

export const loadBlogPostRoute = createServerFn({ method: 'GET' })
  .middleware([staticFunctionMiddleware])
  .validator((input: BlogPostInput) => input)
  .handler(async ({ data }): Promise<BlogEntry> => {
    const slug = slugFromSplat(data.splat);
    if (!slug) throw notFound();

    const { getBlogEntry } = await import('@site/lib/blog.server');
    const entry = getBlogEntry(data.locale, slug);
    if (!entry) throw notFound();

    return entry;
  });

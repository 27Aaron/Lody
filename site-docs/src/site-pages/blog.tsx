import { BlogIndexPage, BlogPostPage } from '@site/components/blog';
import type { BlogEntry, BlogLocale } from '@site/lib/blog';
import { pageHead } from '@site/lib/metadata';
import type { SiteHead } from '@site/lib/metadata';
import { localeCode } from './shared';

export function blogIndexHead(locale: BlogLocale): SiteHead {
  return pageHead({
    title: locale === 'zh' ? '博客' : 'Blog',
    description: locale === 'zh' ? 'Lody 博客' : 'The Lody blog',
    path: locale === 'zh' ? '/zh/blog' : '/blog',
    locale: localeCode(locale),
    alternates: [
      { lang: 'en-US', path: '/blog' },
      { lang: 'zh-CN', path: '/zh/blog' },
    ],
  });
}

export function BlogIndexRoutePage({
  entries,
  locale,
}: {
  entries: BlogEntry[];
  locale: BlogLocale;
}) {
  return <BlogIndexPage entries={entries} locale={locale} />;
}

export function blogPostHead(locale: BlogLocale, data: BlogEntry): SiteHead {
  return pageHead({
    title: data.title,
    description: data.description,
    path: data.url,
    locale: localeCode(locale),
    type: 'article',
    publishedTime: data.date,
    image: data.image,
    alternates: [
      { lang: 'en-US', path: `/blog/${data.slug}` },
      { lang: 'zh-CN', path: `/zh/blog/${data.slug}` },
    ],
  });
}

export function BlogPostRoutePage({ locale, entry }: { locale: BlogLocale; entry: BlogEntry }) {
  return <BlogPostPage entry={entry} locale={locale} />;
}

import { getMDXComponents } from '@site/components/mdx';
import { SiteFooter } from '@site/components/site-footer';
import { SiteNav } from '@site/components/site-nav';
import browserCollections from '@site/.source/browser';
import { formatBlogDate, type BlogEntry, type BlogLocale } from '@site/lib/blog';
import type { ReactNode } from 'react';

const copy = {
  en: {
    title: 'Blog',
    emptyTitle: 'No posts yet',
    emptyDescription: "We're still writing. Check back soon.",
    back: 'Back to blog',
    read: 'Read',
    languageHref: '/zh/blog',
    indexHref: '/blog',
  },
  zh: {
    title: '博客',
    emptyTitle: '暂无文章',
    emptyDescription: '我们还在准备内容，稍后再来看看。',
    back: '返回博客',
    read: '阅读',
    languageHref: '/blog',
    indexHref: '/zh/blog',
  },
} as const;

function isExternalLink(href: string) {
  return /^(?:[a-z]+:)?\/\//iu.test(href);
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

const blogContentLoaders = {
  en: browserCollections.blogEn.createClientLoader({
    id: 'blogEn',
    component({ default: MDX }) {
      return <MDX components={getMDXComponents()} />;
    },
  }),
  zh: browserCollections.blogZh.createClientLoader({
    id: 'blogZh',
    component({ default: MDX }) {
      return <MDX components={getMDXComponents()} />;
    },
  }),
};

export async function preloadBlogContent(locale: BlogLocale, docPath: string) {
  await blogContentLoaders[locale].preload(docPath);
}

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M5 12h14" />
      <path d="m13 5 7 7-7 7" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

function MetaDot() {
  return <span aria-hidden="true" className="blog-meta-dot" />;
}

function BlogMeta({
  entry,
  locale,
  includeAuthor = false,
}: {
  entry: BlogEntry;
  locale: BlogLocale;
  includeAuthor?: boolean;
}) {
  const formattedDate = formatBlogDate(entry.date, locale);
  const items: ReactNode[] = [];

  if (hasText(entry.date) && hasText(formattedDate)) {
    items.push(
      <time dateTime={entry.date} key="date">
        {formattedDate}
      </time>
    );
  }

  if (includeAuthor && hasText(entry.author)) {
    items.push(
      hasText(entry.authorLink) ? (
        <a
          href={entry.authorLink}
          key="author"
          rel={isExternalLink(entry.authorLink) ? 'noreferrer' : undefined}
          target={isExternalLink(entry.authorLink) ? '_blank' : undefined}
        >
          {entry.author}
        </a>
      ) : (
        <span key="author">{entry.author}</span>
      )
    );
  }

  if (hasText(entry.tag)) {
    items.push(<span key="tag">{entry.tag}</span>);
  }

  if (items.length === 0) return null;

  return (
    <p className="blog-meta">
      {items.flatMap((item, index) => (index === 0 ? [item] : [<MetaDot key={`dot-${index}`} />, item]))}
    </p>
  );
}

function PostDate({ date, locale, className }: { date?: string; locale: BlogLocale; className: string }) {
  const dateLabel = formatBlogDate(date, locale);
  if (!hasText(date) || !hasText(dateLabel)) return <span className={className} />;

  return (
    <time className={className} dateTime={date}>
      {dateLabel}
    </time>
  );
}

export function BlogIndexPage({ entries, locale }: { entries: BlogEntry[]; locale: BlogLocale }) {
  const text = copy[locale];
  const [featured, ...rest] = entries;

  return (
    <main className="lody-blog-shell blog-shell">
      <SiteNav locale={locale} languageHref={text.languageHref} />
      <div className="blog-container">
        <header className="blog-header">
          <h1 className="blog-title">{text.title}</h1>
        </header>

        {featured ? (
          <a className="blog-lead" href={featured.url}>
            <div className="blog-lead__copy">
              <PostDate className="blog-lead__date" date={featured.date} locale={locale} />
              <h2 className="blog-lead__title">{featured.title}</h2>
              {hasText(featured.description) ? (
                <p className="blog-lead__dek">{featured.description}</p>
              ) : null}
              <span className="blog-lead__read">
                {text.read}
                <ArrowRightIcon />
              </span>
            </div>
          </a>
        ) : (
          <section className="blog-empty">
            <h2>{text.emptyTitle}</h2>
            <p>{text.emptyDescription}</p>
          </section>
        )}

        {rest.length > 0 ? (
          <ol className="blog-list">
            {rest.map((entry) => (
              <li key={entry.url}>
                <a className="blog-row" href={entry.url}>
                  <PostDate className="blog-row__date" date={entry.date} locale={locale} />
                  <div className="blog-row__body">
                    <h2 className="blog-row__title">{entry.title}</h2>
                    {hasText(entry.description) ? (
                      <p className="blog-row__dek">{entry.description}</p>
                    ) : null}
                  </div>
                </a>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      <SiteFooter locale={locale} />
    </main>
  );
}

export function BlogPostPage({ entry, locale }: { entry: BlogEntry; locale: BlogLocale }) {
  const text = copy[locale];

  return (
    <main className="lody-blog-shell blog-shell">
      <SiteNav
        locale={locale}
        languageHref={locale === 'zh' ? `/blog/${entry.slug}` : `/zh/blog/${entry.slug}`}
      />
      <article className="blog-article">
        <a className="blog-back" href={text.indexHref}>
          <ArrowLeftIcon />
          {text.back}
        </a>

        <header className="blog-article-header">
          <h1 className="blog-article-title">{entry.title}</h1>
          {hasText(entry.description) ? (
            <p className="blog-article-dek">{entry.description}</p>
          ) : null}
          <BlogMeta entry={entry} includeAuthor locale={locale} />
        </header>

        <div className="blog-prose">{blogContentLoaders[locale].useContent(entry.docPath)}</div>
      </article>
      <SiteFooter locale={locale} />
    </main>
  );
}

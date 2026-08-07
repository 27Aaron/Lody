import { getMDXComponents } from '@site/components/mdx';
import { SiteNav } from '@site/components/site-nav';
import browserCollections from '@site/.source/browser';
import { formatBlogDate, type BlogEntry, type BlogLocale } from '@site/lib/blog';

const copy = {
  en: {
    eyebrow: 'Blog',
    title: 'News & Updates',
    description: 'Product announcements, engineering insights, and stories from the Lody team.',
    emptyTitle: 'No posts yet',
    emptyDescription: "We're still writing. Check back soon.",
    defaultTag: 'Announcement',
    back: 'Back to blog',
    docs: 'Docs',
    home: 'Home',
    homeHref: '/home',
    docsHref: '/docs',
  },
  zh: {
    eyebrow: '博客',
    title: '新闻与更新',
    description: '产品公告、工程洞见以及来自 Lody 团队的故事。',
    emptyTitle: '暂无文章',
    emptyDescription: '我们还在准备内容，稍后再来看看。',
    defaultTag: '公告',
    back: '返回博客',
    docs: '文档',
    home: '首页',
    homeHref: '/zh/home',
    docsHref: '/zh/docs',
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

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect height="18" rx="2" ry="2" width="18" x="3" y="4" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

function BlogFooter({ locale }: { locale: BlogLocale }) {
  const text = copy[locale];

  return (
    <footer className="flex justify-center gap-6 text-sm text-fd-muted-foreground">
      <a className="hover:text-fd-foreground" href={text.docsHref}>
        {text.docs}
      </a>
      <a className="hover:text-fd-foreground" href={text.homeHref}>
        {text.home}
      </a>
      <a className="hover:text-fd-foreground" href="https://discord.gg/E8mZtMu38s">
        Discord
      </a>
    </footer>
  );
}

export function BlogIndexPage({ entries, locale }: { entries: BlogEntry[]; locale: BlogLocale }) {
  const text = copy[locale];

  return (
    <main className="lody-blog-shell">
      <SiteNav locale={locale} languageHref={locale === 'zh' ? '/blog' : '/zh/blog'} />
      <div className="mx-auto flex w-[min(1100px,92vw)] flex-col gap-12 pb-16 pt-28">
        <header className="text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-fd-primary">
            {text.eyebrow}
          </p>
          <h1 className="m-0 text-4xl font-bold tracking-tight md:text-5xl">{text.title}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-fd-muted-foreground">{text.description}</p>
        </header>

        {entries.length > 0 ? (
          <section className="grid gap-5 md:grid-cols-2">
            {entries.map((entry) => (
              <a
                className="group overflow-hidden rounded-3xl border bg-fd-card text-fd-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-fd-primary/60 hover:shadow-xl"
                href={entry.url}
                key={entry.url}
              >
                <div className="flex h-full flex-col">
                  <div className="relative flex min-h-56 items-center justify-center overflow-hidden border-b bg-fd-muted">
                    {hasText(entry.image) ? (
                      <img
                        alt={entry.title}
                        className="h-full min-h-56 w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                        loading="lazy"
                        src={entry.image}
                      />
                    ) : (
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklab,var(--color-fd-primary)_34%,transparent),transparent_35%),linear-gradient(135deg,var(--color-fd-muted),var(--color-fd-background))]" />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-4 p-6">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-fd-muted-foreground">
                      {hasText(entry.date) ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
                          <CalendarIcon />
                          {formatBlogDate(entry.date, locale)}
                        </span>
                      ) : null}
                      {hasText(entry.author) ? (
                        <span className="rounded-full border px-2.5 py-1">{entry.author}</span>
                      ) : null}
                      <span className="rounded-full border border-fd-primary/40 bg-fd-primary/10 px-2.5 py-1 text-fd-primary">
                        {entry.tag ?? text.defaultTag}
                      </span>
                    </div>
                    <div className="space-y-3">
                      <h2 className="m-0 text-2xl font-semibold tracking-tight">{entry.title}</h2>
                      {hasText(entry.description) ? (
                        <p className="m-0 line-clamp-3 text-sm leading-6 text-fd-muted-foreground">
                          {entry.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </section>
        ) : (
          <section className="mx-auto max-w-xl rounded-3xl border bg-fd-card p-10 text-center shadow-sm">
            <h2 className="m-0 text-2xl font-semibold">{text.emptyTitle}</h2>
            <p className="mt-3 text-fd-muted-foreground">{text.emptyDescription}</p>
          </section>
        )}

        <BlogFooter locale={locale} />
      </div>
    </main>
  );
}

export function BlogPostPage({ entry, locale }: { entry: BlogEntry; locale: BlogLocale }) {
  const text = copy[locale];
  const formattedDate = formatBlogDate(entry.date, locale);

  return (
    <main className="lody-blog-shell">
      <SiteNav
        locale={locale}
        languageHref={locale === 'zh' ? `/blog/${entry.slug}` : `/zh/blog/${entry.slug}`}
      />
      <article className="mx-auto flex w-[min(860px,92vw)] flex-col gap-8 pb-16 pt-28">
        <header>
          <a
            className="text-sm text-fd-muted-foreground hover:text-fd-foreground"
            href={locale === 'zh' ? '/zh/blog' : '/blog'}
          >
            {text.back}
          </a>

          <div className="mt-8 space-y-5 rounded-3xl border bg-fd-card p-7 shadow-sm md:p-9">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fd-muted-foreground">
              {hasText(entry.tag) ? (
                <span className="rounded-full border border-fd-primary/40 bg-fd-primary/10 px-2.5 py-1 text-fd-primary">
                  {entry.tag}
                </span>
              ) : null}
              {hasText(entry.date) && hasText(formattedDate) ? (
                <time className="rounded-full border px-2.5 py-1" dateTime={entry.date}>
                  {formattedDate}
                </time>
              ) : null}
              {hasText(entry.author) && hasText(entry.authorLink) ? (
                <a
                  className="rounded-full border px-2.5 py-1 hover:text-fd-foreground"
                  href={entry.authorLink}
                  rel={isExternalLink(entry.authorLink) ? 'noreferrer' : undefined}
                  target={isExternalLink(entry.authorLink) ? '_blank' : undefined}
                >
                  {entry.author}
                </a>
              ) : hasText(entry.author) ? (
                <span className="rounded-full border px-2.5 py-1">{entry.author}</span>
              ) : null}
            </div>
            <h1 className="m-0 text-4xl font-bold tracking-tight md:text-5xl">{entry.title}</h1>
            {hasText(entry.description) ? (
              <p className="m-0 text-lg leading-8 text-fd-muted-foreground">{entry.description}</p>
            ) : null}
          </div>

          {hasText(entry.image) ? (
            <div className="mt-8 overflow-hidden rounded-3xl border bg-fd-muted shadow-sm">
              <img
                alt={entry.title}
                className="max-h-[460px] w-full object-cover"
                loading="eager"
                src={entry.image}
              />
            </div>
          ) : null}
        </header>

        <div className="lody-blog-post-body prose max-w-none dark:prose-invert">
          {blogContentLoaders[locale].useContent(entry.docPath)}
        </div>

        <BlogFooter locale={locale} />
      </article>
    </main>
  );
}

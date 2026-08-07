import { BlogIndexPage, BlogPostPage } from '@site/components/blog';
import { ChangelogDetailPage, ChangelogIndexPage } from '@site/components/changelog';
import { DocsTocLanguageSelect } from '@site/components/docs-toc-language-select';
import { DownloadPage } from '@site/components/download-page';
import { LandingPage } from '@site/components/landing';
import { LegalPage } from '@site/components/legal-page';
import { getMDXComponents } from '@site/components/mdx';
import { PricingPage } from '@site/components/pricing-page';
import type { BlogEntry, BlogLocale } from '@site/lib/blog';
import type { ChangelogEntry, ChangelogLocale } from '@site/lib/changelog';
import type { LegalPageEntry, PageLocale } from '@site/lib/pages';
import { baseOptions } from '@site/lib/layout.shared';
import {
  landingJsonLd,
  landingMetaDescription,
  landingPageTitle,
} from '@site/lib/landing-seo';
import { pageHead } from '@site/lib/metadata';
import type { SiteHead } from '@site/lib/metadata';
import browserCollections from '@site/.source/browser';
import { deserializePageTree } from 'fumadocs-core/source/client';
import type { SerializedPageTree } from 'fumadocs-core/source/client';
import type { TOCItemType } from 'fumadocs-core/toc';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsSidebarFooter } from '@site/components/docs-sidebar-footer';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';

export type SiteLocale = 'en' | 'zh';

type DocsRouteData = {
  title: string;
  description?: string;
  path: string;
  docPath: string;
  pageTree: SerializedPageTree;
  toc: SerializedTocItem[];
  slug?: string[];
};

type SerializedTocItem = Omit<TOCItemType, 'title'> & {
  title: string;
};

type ChangelogPostRouteData = {
  entry: ChangelogEntry;
  newer?: ChangelogEntry;
  older?: ChangelogEntry;
};

const landingAlternates = [
  { lang: 'en-US' as const, path: '/' },
  { lang: 'zh-CN' as const, path: '/zh' },
];

function localeCode(locale: SiteLocale) {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}

const docsContentLoaders = {
  en: browserCollections.docsEn.createClientLoader({
    id: 'docsEn',
    component({ default: MDX }) {
      return <MDX components={getMDXComponents()} />;
    },
  }),
  zh: browserCollections.docsZh.createClientLoader({
    id: 'docsZh',
    component({ default: MDX }) {
      return <MDX components={getMDXComponents()} />;
    },
  }),
};

export function landingHead(locale: SiteLocale, options?: { noindex?: boolean }): SiteHead {
  return pageHead({
    title: landingPageTitle(locale),
    description: landingMetaDescription(locale),
    path: locale === 'zh' ? '/zh' : '/',
    locale: localeCode(locale),
    alternates: landingAlternates,
    robots: options?.noindex ? { index: false, follow: true } : undefined,
    jsonLd: landingJsonLd(locale),
  });
}

export function LandingRoutePage({ locale }: { locale: SiteLocale }) {
  return <LandingPage locale={locale} />;
}

export function downloadHead(locale: SiteLocale): SiteHead {
  return pageHead({
    title: locale === 'zh' ? '下载 Lody' : 'Download Lody',
    description:
      locale === 'zh'
        ? '下载 Lody 桌面端、移动端客户端，或打开浏览器版本。'
        : 'Download Lody clients for desktop, mobile, and browser access.',
    path: locale === 'zh' ? '/zh/download' : '/download',
    locale: localeCode(locale),
    alternates: [
      { lang: 'en-US', path: '/download' },
      { lang: 'zh-CN', path: '/zh/download' },
    ],
  });
}

export function DownloadRoutePage({ locale }: { locale: SiteLocale }) {
  return <DownloadPage locale={locale} />;
}

export function pricingHead(locale: SiteLocale): SiteHead {
  return pageHead({
    title: locale === 'zh' ? '价格' : 'Pricing',
    description:
      locale === 'zh'
        ? 'Lody 免费版、Plus 和企业版价格。'
        : 'Lody pricing for Free, Plus, and Enterprise plans.',
    path: locale === 'zh' ? '/zh/price' : '/price',
    locale: localeCode(locale),
    alternates: [
      { lang: 'en-US', path: '/price' },
      { lang: 'zh-CN', path: '/zh/price' },
    ],
  });
}

export function PricingRoutePage({ locale }: { locale: SiteLocale }) {
  // Early-bird yearly ($5/seat/mo) is fixed static copy on PricingPage — no
  // client clock / env gate (avoids $8 → $5 flash on first paint).
  return <PricingPage locale={locale} />;
}

export function legalPageHead(locale: PageLocale, entry: LegalPageEntry): SiteHead {
  const enPath = `/${entry.slug}`;
  const zhPath = `/zh/${entry.slug}`;

  return pageHead({
    title: entry.title,
    description: entry.description,
    path: entry.url,
    locale: localeCode(locale),
    alternates: [
      { lang: 'en-US', path: enPath },
      { lang: 'zh-CN', path: zhPath },
    ],
  });
}

export function LegalRoutePage({
  entry,
  locale,
}: {
  entry: LegalPageEntry;
  locale: PageLocale;
}) {
  return <LegalPage entry={entry} locale={locale} />;
}

export function blogIndexHead(locale: BlogLocale): SiteHead {
  return pageHead({
    title: locale === 'zh' ? '博客' : 'Blog',
    description:
      locale === 'zh'
        ? '来自 Lody 团队的产品公告、工程洞察和发布故事。'
        : 'Product announcements, engineering insights, and release stories from the Lody team.',
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

export function changelogIndexHead(locale: ChangelogLocale): SiteHead {
  return pageHead({
    title: locale === 'zh' ? '更新日志' : 'Changelog',
    description:
      locale === 'zh'
        ? '追踪 Lody 的产品更新、改进和修复。'
        : 'Track product updates, improvements, and fixes released across Lody.',
    path: locale === 'zh' ? '/zh/changelog' : '/changelog',
    locale: localeCode(locale),
    alternates: [
      { lang: 'en-US', path: '/changelog' },
      { lang: 'zh-CN', path: '/zh/changelog' },
    ],
  });
}

export function ChangelogIndexRoutePage({
  entries,
  locale,
}: {
  entries: ChangelogEntry[];
  locale: ChangelogLocale;
}) {
  return <ChangelogIndexPage entries={entries} locale={locale} />;
}

export function changelogPostHead(locale: ChangelogLocale, data: ChangelogPostRouteData): SiteHead {
  const { entry } = data;
  const enPath = `/changelog/${entry.slug}`;

  return pageHead({
    title: entry.title,
    description: entry.description ?? `Lody ${entry.version} release notes.`,
    path: entry.url,
    locale: localeCode(locale),
    type: 'article',
    publishedTime: entry.date,
    alternates: [
      { lang: 'en-US', path: enPath },
      { lang: 'zh-CN', path: `/zh${enPath}` },
    ],
  });
}

export function ChangelogPostRoutePage({
  data,
  locale,
}: {
  data: ChangelogPostRouteData;
  locale: ChangelogLocale;
}) {
  return (
    <ChangelogDetailPage entry={data.entry} newer={data.newer} older={data.older} locale={locale} />
  );
}

export function docsHead(locale: SiteLocale, data: DocsRouteData): SiteHead {
  const enPath = locale === 'zh' ? data.path.replace(/^\/zh/u, '') || '/docs' : data.path;
  const zhPath = enPath === '/docs' ? '/zh/docs' : `/zh${enPath}`;

  return pageHead({
    title: data.title,
    description: data.description,
    path: data.path,
    locale: localeCode(locale),
    alternates: [
      { lang: 'en-US', path: enPath },
      { lang: 'zh-CN', path: zhPath },
    ],
  });
}

export async function preloadDocsContent(locale: SiteLocale, docPath: string) {
  await docsContentLoaders[locale].preload(docPath);
}

function deserializeToc(toc: SerializedTocItem[]): TOCItemType[] {
  return toc.map((item) => ({
    ...item,
    title: <span dangerouslySetInnerHTML={{ __html: item.title }} />,
  }));
}

export function DocsRoutePage({ locale, data }: { locale: SiteLocale; data: DocsRouteData }) {
  return (
    <DocsLayout
      {...baseOptions(locale)}
      tree={deserializePageTree(data.pageTree)}
      sidebar={{
        defaultOpenLevel: 1,
        footer: <DocsSidebarFooter />,
      }}
    >
      <DocsPage
        toc={deserializeToc(data.toc)}
        tableOfContent={{
          header: <DocsTocLanguageSelect />,
        }}
        tableOfContentPopover={{
          header: <DocsTocLanguageSelect />,
        }}
      >
        <DocsTitle>{data.title}</DocsTitle>
        <DocsDescription>{data.description}</DocsDescription>
        <DocsBody>{docsContentLoaders[locale].useContent(data.docPath)}</DocsBody>
      </DocsPage>
    </DocsLayout>
  );
}

export type { ChangelogPostRouteData, DocsRouteData };

export function SiteNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium uppercase tracking-[0.22em] text-fd-muted-foreground">
        404
      </p>
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="max-w-md text-fd-muted-foreground">
        The page does not exist in the current documentation build.
      </p>
      <a className="text-sm font-medium text-fd-primary hover:underline" href="/docs">
        Back to docs
      </a>
    </main>
  );
}

'use client';

/**
 * Landing post-demo — team collaboration surfaces that already ship:
 * usage by member + in-session PR/CI/merge demos, plus short team points
 * (shared sessions, private machines). Diff review stays in the play stage.
 */

import { useEffect, useState } from 'react';
import { LandingPowerDemo, type PowerDemoId } from './landing-power-demos';

export type PowerSectionCopy = {
  /** Optional category label, e.g. Team. */
  eyebrow?: string;
  title: string;
  body: string;
  /**
   * Compact team beats that don't need a product demo (e.g. shared sessions).
   * Rendered as a short list under the header — no pills / media.
   */
  points?: readonly string[];
  features: readonly {
    id: PowerDemoId;
    title: string;
    /** Optional; omit or empty when the demo already carries the story. */
    body?: string;
  }[];
};

/**
 * Product demos pull packages/components (NumberFlow, Radix, …) that peer React
 * 18 in the monorepo. Mount only after hydration so SSR never dual-loads React.
 */
function ClientPowerDemo({
  id,
  locale,
  title,
  summary,
}: {
  id: PowerDemoId;
  locale: 'en' | 'zh';
  title: string;
  /** SSR-visible summary so crawlers still get the feature without hydrate. */
  summary?: string;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) {
    return (
      <div className="uw-power__demo uw-power__demo--ssr lody-app-preview dark">
        <p className="uw-power__demo-ssr-title">{title}</p>
        {summary ? <p className="uw-power__demo-ssr-body">{summary}</p> : null}
      </div>
    );
  }
  return <LandingPowerDemo id={id} locale={locale} />;
}

export function LandingPowerSection({
  copy,
  locale,
}: {
  copy: PowerSectionCopy;
  locale: 'en' | 'zh';
}) {
  return (
    <section className="uw-power" aria-labelledby="uw-power-title">
      <div className="uw-power__inner">
        <header className="uw-power__header">
          {copy.eyebrow ? <p className="uw-power__eyebrow">{copy.eyebrow}</p> : null}
          <h2 className="uw-power__title" id="uw-power-title">
            {copy.title}
          </h2>
          <p className="uw-power__body">{copy.body}</p>
          {copy.points && copy.points.length > 0 ? (
            <ul className="uw-power__points">
              {copy.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          ) : null}
        </header>

        <div className="uw-power__grid">
          {copy.features.map((feature) => (
            <article key={feature.id} className="uw-power__card">
              <ClientPowerDemo
                id={feature.id}
                locale={locale}
                title={feature.title}
                summary={feature.body}
              />
              <h3 className="uw-power__card-title">{feature.title}</h3>
              {feature.body ? <p className="uw-power__card-body">{feature.body}</p> : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LandingPowerSection;

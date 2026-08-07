'use client';

/**
 * Landing post-demo — mobile + Dynamic Island / Live Activities.
 * Real-device media only — do not simulate the island inside the feature-tab stage.
 * Keep copy short: title + one line, no bullet lists.
 */

export type MobileDeepSectionCopy = {
  /** Optional category label. Omit when the title already carries the meaning. */
  eyebrow?: string;
  title: string;
  body: string;
  /** Real-device still (or loop poster) under `/landing/…`. */
  mediaImage?: string;
  mediaAlt?: string;
  /** Fallback when `mediaImage` is missing. */
  mediaPlaceholder?: string;
  /** Optional caption under the media (omit once real asset is in). */
  mediaNote?: string;
};

export function LandingMobileDeepSection({ copy }: { copy: MobileDeepSectionCopy }) {
  return (
    <section className="uw-mobile-deep" aria-labelledby="uw-mobile-deep-title">
      <div className="uw-mobile-deep__inner">
        {/* Island still above the title — no card chrome around the photo. */}
        <div className="uw-mobile-deep__media">
          {copy.mediaImage ? (
            <div className="uw-media uw-media--island uw-media--bare">
              <img
                src={copy.mediaImage}
                alt={copy.mediaAlt ?? ''}
                loading="lazy"
                decoding="async"
              />
            </div>
          ) : (
            <div
              className="uw-media-placeholder uw-media-placeholder--phone"
              data-label={copy.mediaPlaceholder}
            >
              <span className="uw-media-placeholder__label">{copy.mediaPlaceholder}</span>
            </div>
          )}
          {copy.mediaNote ? <p className="uw-mobile-deep__media-note">{copy.mediaNote}</p> : null}
        </div>

        <div className="uw-mobile-deep__copy">
          {copy.eyebrow ? <p className="uw-mobile-deep__eyebrow">{copy.eyebrow}</p> : null}
          <h2 className="uw-mobile-deep__title" id="uw-mobile-deep-title">
            {copy.title}
          </h2>
          <p className="uw-mobile-deep__body">{copy.body}</p>
        </div>
      </div>
    </section>
  );
}

export default LandingMobileDeepSection;

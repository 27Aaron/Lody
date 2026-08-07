import { useLayoutEffect } from 'react';
import { PhotoSlider } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import './zoomable-image-viewer.css';

/**
 * The single full-screen image viewer for the whole app: pinch-to-zoom,
 * double-tap zoom, wheel zoom, drag-to-pan, and the top-right close button all
 * come from `react-photo-view`'s `PhotoSlider`. Chat image blocks and the Code
 * Collab file preview both mount THIS component, so the gestures stay identical
 * between them — do not hand-roll a second zoom surface for a new caller.
 *
 * `react-photo-view@1.2.7` is patched in root `patches/` to hard-clamp the
 * minimum pinch scale at `1`. Do not replace that with an outer
 * `overlayRender`/React state clamp; that fights PhotoView's touch state.
 */

export type ZoomableImageViewerItem = {
  readonly key: string;
  /** Undefined while the full-size source is still loading. */
  readonly src: string | undefined;
};

export type ImagePreviewPortalAnchorRef = { readonly current: HTMLElement | null };

/**
 * Inside mobile Vaul drawers, do not let the viewer default its portal to
 * `document.body`: Radix/Vaul treats body portals as outside the drawer, so
 * touch/scroll can be blocked or fall through. Resolve the real
 * `[data-vaul-drawer]` instead (the `data-vaul-no-drag` wrapper is only a
 * `display: contents` fallback). Returns undefined outside a drawer, where the
 * library's own body portal is correct.
 */
export const resolveImagePreviewPortalContainer = (
  anchor: HTMLElement | null | undefined
): HTMLElement | undefined => {
  if (typeof document === 'undefined') {
    return undefined;
  }

  return (
    anchor?.closest<HTMLElement>('[data-vaul-drawer]') ??
    anchor?.closest<HTMLElement>('[data-vaul-no-drag]') ??
    undefined
  );
};

/**
 * Mark the mounted portal root `data-vaul-no-drag` so Vaul does not take over
 * the viewer's pan/pinch gestures and drag the drawer toward dismissal.
 */
export function useImagePreviewPortalNoDrag(
  active: boolean,
  portalContainer: HTMLElement | undefined
) {
  useLayoutEffect(() => {
    if (!active || !portalContainer) {
      return undefined;
    }

    const portal = portalContainer.querySelector<HTMLElement>(
      ':scope > .lody-photo-slider.PhotoView-Portal'
    );
    if (!portal) {
      return undefined;
    }

    portal.setAttribute('data-vaul-no-drag', '');
    return () => {
      portal.removeAttribute('data-vaul-no-drag');
    };
  }, [active, portalContainer]);
}

export type ZoomableImageViewerProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Keep this array referentially stable (memoize it) — a fresh identity every
   *  render makes the slider re-mount its photos mid-gesture. */
  readonly images: ZoomableImageViewerItem[];
  readonly index: number;
  readonly onIndexChange?: (index: number) => void;
  /**
   * An element inside the surface that opened the viewer. Used only to find the
   * enclosing Vaul drawer; pass the scroll root or the preview container.
   */
  readonly portalAnchorRef?: ImagePreviewPortalAnchorRef;
};

export function ZoomableImageViewer({
  open,
  onClose,
  images,
  index,
  onIndexChange,
  portalAnchorRef,
}: ZoomableImageViewerProps) {
  const portalContainer = resolveImagePreviewPortalContainer(portalAnchorRef?.current);
  useImagePreviewPortalNoDrag(open, portalContainer);

  if (!open || index < 0 || index >= images.length) {
    return null;
  }

  return (
    <PhotoSlider
      className="lody-photo-slider"
      images={images}
      visible={open}
      onClose={onClose}
      index={index}
      {...(onIndexChange ? { onIndexChange } : {})}
      maskClosable
      photoClosable
      photoClassName="lody-photo-slider-image"
      photoWrapClassName="lody-photo-slider-photo-wrap"
      {...(portalContainer ? { portalContainer } : {})}
    />
  );
}

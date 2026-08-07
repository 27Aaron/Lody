import { useTheme } from 'next-themes';
import { Toaster as Sonner, ToasterProps } from 'sonner';

const TOASTER_OFFSET = {
  top: 'calc(24px + env(safe-area-inset-top, 0px))',
} satisfies ToasterProps['offset'];

const MOBILE_TOASTER_OFFSET = {
  top: 'calc(16px + env(safe-area-inset-top, 0px))',
} satisfies ToasterProps['mobileOffset'];

const Toaster = ({
  closeButton = true,
  position = 'top-center',
  offset = TOASTER_OFFSET,
  mobileOffset = MOBILE_TOASTER_OFFSET,
  style,
  toastOptions,
  ...props
}: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      closeButton={closeButton}
      position={position}
      offset={offset}
      mobileOffset={mobileOffset}
      toastOptions={{
        ...toastOptions,
        classNames: {
          // Leave room on the right for the inline close button so long
          // messages don't slip underneath it.
          toast: 'pr-9!',
          // Sonner ships a circular close button floating on the top-left
          // corner. Restyle it into a plain, muted "×" tucked inside on the
          // right edge and vertically centered (matches the neutral design).
          closeButton:
            'left-auto! right-2! top-1/2! -translate-y-1/2! size-5! rounded-md! border-transparent! bg-transparent! text-muted-foreground! transition-colors! hover:bg-muted! hover:text-foreground!',
          ...toastOptions?.classNames,
        },
      }}
      style={
        {
          // `--z-toast` is declared in the editor-overlay z-index registry but never
          // injected as a CSS variable, so it resolves to `auto` and toasts can render
          // behind positioned UI (e.g. the session header at top-center). Fall back to
          // the registry's toast layer (100) so toasts always sit on top.
          zIndex: 'var(--z-toast, 100)',
          // These tokens are raw HSL triplets (e.g. `214 32% 91%`), so they must
          // be wrapped in `hsl(...)` to be valid colors — Sonner drops them into
          // bare `background`/`color`/`border` declarations. The background is an
          // elevated `color-mix` (same recipe as the app's dropdown surfaces in
          // `menu-styles.ts`) so the toast stays distinct from the page even in
          // themes where `--popover` equals `--background` (e.g. light mode).
          '--normal-bg':
            'color-mix(in oklab, hsl(var(--popover)) 92%, hsl(var(--foreground)) 8%)',
          '--normal-text': 'hsl(var(--popover-foreground))',
          '--normal-border': 'hsl(var(--border))',
          // Cancel Sonner's default corner-float transform so the close button
          // sits inline; vertical centering is handled by the `closeButton`
          // classNames (`top-1/2` + `-translate-y-1/2`).
          '--toast-close-button-transform': 'none',
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  DEFAULT_VSCODE_THEME_SELECTION,
  applyVSCodeThemeCssVariables,
  createLodyVSCodeShikiThemeName,
  getBundledVSCodeThemeByIdSync,
  getCachedBundledVSCodeThemes,
  getRegisteredLodyVSCodeThemeForDiffs,
  isSelectableBundledVSCodeThemeId,
  resolveBundledVSCodeThemes,
  registerLodyVSCodeThemeForDiffs,
  type LodyResolvedVSCodeTheme,
  type VSCodeThemeMode,
  type VSCodeThemeSelection,
} from '@/lib/vscode-theme';

type Theme = 'dark' | 'light' | 'system';

/**
 * The app ships exactly two themes: Lody Light (cool white) and Vesper
 * (dark). The underlying VS Code theme selection is FIXED — users only choose
 * light vs dark, so there is no per-mode theme picker, nothing is persisted,
 * and the setters below are inert. The bundled VS Code theme machinery stays
 * only to drive syntax colors for the editor/diff/terminal at these two ids.
 */
const FIXED_VSCODE_THEME_SELECTION: VSCodeThemeSelection = DEFAULT_VSCODE_THEME_SELECTION;

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** Apply theme visually without persisting to localStorage. */
  previewTheme: (theme: Theme) => void;
  vscodeThemeSelection: VSCodeThemeSelection;
  setVSCodeThemeSelection: (selection: VSCodeThemeSelection) => void;
  setVSCodeThemeId: (mode: VSCodeThemeMode, themeId: string | undefined) => void;
  /** Apply VS Code theme visually without persisting to localStorage. */
  previewVSCodeThemeId: (mode: VSCodeThemeMode, themeId: string | undefined) => void;
};

export type ResolvedTheme = 'light' | 'dark';

const initialState: ThemeProviderState = {
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => null,
  previewTheme: () => null,
  vscodeThemeSelection: FIXED_VSCODE_THEME_SELECTION,
  setVSCodeThemeSelection: () => null,
  setVSCodeThemeId: () => null,
  previewVSCodeThemeId: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function getSystemResolvedTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? 'dark' : 'light';
}

function parseStoredTheme(value: string | null): Theme | null {
  if (value === 'dark' || value === 'light' || value === 'system') {
    return value;
  }
  return null;
}

function readStoredTheme(storageKey: string): Theme | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return parseStoredTheme(window.localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

function writeStoredTheme(storageKey: string, theme: Theme): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // Ignore storage failures on restricted browsers.
  }
}

const getActiveVSCodeThemeId = (
  resolvedTheme: ResolvedTheme,
  vscodeThemeSelection: VSCodeThemeSelection
): string | undefined => {
  return resolvedTheme === 'dark'
    ? vscodeThemeSelection.darkThemeId
    : vscodeThemeSelection.lightThemeId;
};

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme(storageKey) ?? defaultTheme);
  const [systemResolvedTheme, setSystemResolvedTheme] =
    useState<ResolvedTheme>(getSystemResolvedTheme);
  const resolvedTheme = theme === 'system' ? systemResolvedTheme : theme;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      setSystemResolvedTheme(event.matches ? 'dark' : 'light');
    };

    setSystemResolvedTheme(mediaQuery.matches ? 'dark' : 'light');

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
      return () => {
        mediaQuery.removeEventListener('change', handleSystemThemeChange);
      };
    }

    mediaQuery.addListener(handleSystemThemeChange);
    return () => {
      mediaQuery.removeListener(handleSystemThemeChange);
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  // On Electron, keep the OS-drawn window chrome (notably the Windows title bar)
  // matching the in-app theme. Preserve `system` as the native source; rerun
  // when its resolved mode changes so Electron can repaint explicit surfaces.
  useEffect(() => {
    window.api?.setNativeTheme?.(theme);
  }, [resolvedTheme, theme]);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue !== theme) {
        setTheme(parseStoredTheme(e.newValue) ?? defaultTheme);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [defaultTheme, storageKey, theme]);

  useIsomorphicLayoutEffect(() => {
    const root = window.document.documentElement;
    const activeThemeId = getActiveVSCodeThemeId(resolvedTheme, FIXED_VSCODE_THEME_SELECTION);
    if (!activeThemeId) {
      return undefined;
    }

    const activeTheme = getBundledVSCodeThemeByIdSync(activeThemeId);
    if (!activeTheme) {
      return undefined;
    }
    const application = applyVSCodeThemeCssVariables(root, activeTheme);

    return () => {
      application.dispose();
    };
  }, [resolvedTheme]);

  const value = {
    theme,
    resolvedTheme,
    setTheme: (nextTheme: Theme) => {
      writeStoredTheme(storageKey, nextTheme);
      setTheme(nextTheme);
    },
    previewTheme: (previewThemeValue: Theme) => {
      setTheme(previewThemeValue);
    },
    // Theme selection is fixed to the two bundled themes; these remain on the
    // context for API compatibility but intentionally do nothing.
    vscodeThemeSelection: FIXED_VSCODE_THEME_SELECTION,
    setVSCodeThemeSelection: () => {},
    setVSCodeThemeId: () => {},
    previewVSCodeThemeId: () => {},
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};

export const useResolvedTheme = (): ResolvedTheme => {
  return useTheme().resolvedTheme;
};

export const useActiveVSCodeThemeId = (): string | undefined => {
  const resolvedTheme = useResolvedTheme();
  const { vscodeThemeSelection } = useTheme();
  return resolvedTheme === 'dark'
    ? vscodeThemeSelection.darkThemeId
    : vscodeThemeSelection.lightThemeId;
};

export const useActiveVSCodeTheme = (): LodyResolvedVSCodeTheme | undefined => {
  const activeThemeId = useActiveVSCodeThemeId();
  return useMemo(
    () => (activeThemeId ? getBundledVSCodeThemeByIdSync(activeThemeId) : undefined),
    [activeThemeId]
  );
};

export const useBundledVSCodeThemes = (): LodyResolvedVSCodeTheme[] => {
  const [loaded, setLoaded] = useState(() => getCachedBundledVSCodeThemes() !== undefined);
  const [themes, setThemes] = useState<LodyResolvedVSCodeTheme[]>(() => [
    ...(getCachedBundledVSCodeThemes() ?? []),
  ]);

  useEffect(() => {
    if (loaded) {
      return undefined;
    }

    let cancelled = false;

    void resolveBundledVSCodeThemes()
      .then((bundledThemes) => {
        if (!cancelled) {
          setThemes(bundledThemes);
          setLoaded(true);
        }
      })
      .catch((error: unknown) => {
        console.warn('[vscode-theme] Failed to load bundled themes', error);
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loaded]);

  return themes;
};

export const useSelectableBundledVSCodeThemes = (): LodyResolvedVSCodeTheme[] => {
  const themes = useBundledVSCodeThemes();
  return useMemo(
    () => themes.filter((theme) => isSelectableBundledVSCodeThemeId(theme.id)),
    [themes]
  );
};

export const useActiveVSCodeDiffThemeName = (): string | undefined => {
  const activeTheme = useActiveVSCodeTheme();
  const activeDiffThemeName = activeTheme ? createLodyVSCodeShikiThemeName(activeTheme) : undefined;
  const [registeredDiffThemeName, setRegisteredDiffThemeName] = useState<string | undefined>(() =>
    activeTheme ? getRegisteredLodyVSCodeThemeForDiffs(activeTheme) : undefined
  );

  useIsomorphicLayoutEffect(() => {
    if (!activeTheme) {
      setRegisteredDiffThemeName(undefined);
      return undefined;
    }

    const registeredName = getRegisteredLodyVSCodeThemeForDiffs(activeTheme);
    setRegisteredDiffThemeName(registeredName);
    if (registeredName) {
      return undefined;
    }

    let cancelled = false;
    void registerLodyVSCodeThemeForDiffs(activeTheme).then((name) => {
      if (!cancelled) {
        setRegisteredDiffThemeName(name);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTheme]);

  const cachedRegisteredName = activeTheme
    ? getRegisteredLodyVSCodeThemeForDiffs(activeTheme)
    : undefined;
  return (
    cachedRegisteredName ??
    (registeredDiffThemeName === activeDiffThemeName ? registeredDiffThemeName : undefined)
  );
};

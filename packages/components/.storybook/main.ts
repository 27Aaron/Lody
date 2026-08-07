import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { join, dirname, resolve } from 'path';
import { createRequire } from 'node:module';
import { requirePreviewPublicBaseDomain } from '../../../scripts/preview-public-base-domain.mjs';

const require = createRequire(__filename);

/**
 * This function is used to resolve the absolute path of a package.
 * It is needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value: string): string {
  return dirname(require.resolve(join(value, 'package.json')));
}

const config: StorybookConfig = {
  stories: ['../src/stories/**/*.mdx', '../src/stories/**/*.stories.@(js|jsx|ts|tsx)'],
  framework: {
    name: getAbsolutePath('@storybook/react-vite'),
    options: {},
  },
  async viteFinal(viteConfig) {
    const mode = viteConfig.mode ?? 'development';
    const previewPublicBaseDomain = requirePreviewPublicBaseDomain(
      { ...loadEnv(mode, resolve(__dirname, '..'), ''), ...process.env },
      `@lody/components Storybook (${mode})`
    );
    viteConfig.define = {
      ...viteConfig.define,
      'import.meta.env.VITE_PREVIEW_PUBLIC_BASE_DOMAIN': JSON.stringify(previewPublicBaseDomain),
    };
    viteConfig.plugins = (viteConfig.plugins ?? []).filter((plugin) => {
      if (!plugin) return false;
      const name = 'name' in plugin ? String(plugin.name) : '';
      if (name === 'dts' || name === 'vite:dts') return false;
      if (name.includes('tanstack')) return false;
      return true;
    });
    viteConfig.plugins.push(tailwindcss());

    viteConfig.worker = {
      ...(viteConfig.worker ?? {}),
      format: 'es',
    };

    if (process.env.STORYBOOK_DEBUG_PLUGINS === '1') {
      // eslint-disable-next-line no-console
      console.log(
        'storybook vite plugins:',
        (viteConfig.plugins ?? [])
          .map((p) => ('name' in p ? String(p.name) : ''))
          .filter(Boolean)
          .sort()
      );
    }
    return viteConfig;
  },
};

export default config;

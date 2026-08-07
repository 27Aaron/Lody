import { session } from 'electron'

const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1'
const PROXY_ENV_KEYS = [
  'ALL_PROXY',
  'all_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'npm_config_proxy',
  'npm_config_http_proxy',
  'npm_config_https_proxy'
] as const

export const DEFAULT_SYSTEM_PROXY_PROBE_URLS = ['https://registry.npmjs.org'] as const

export function hasProxyEnv(env: NodeJS.ProcessEnv): boolean {
  return PROXY_ENV_KEYS.some((key) => {
    const value = env[key]
    return typeof value === 'string' && value.trim().length > 0
  })
}

export function applyProxyEnvFallback(env: NodeJS.ProcessEnv, proxyEnv: NodeJS.ProcessEnv): void {
  if (hasProxyEnv(env) || !hasProxyEnv(proxyEnv)) {
    return
  }

  for (const key of PROXY_ENV_KEYS) {
    const value = proxyEnv[key]
    if (typeof value === 'string' && value.trim().length > 0 && env[key] === undefined) {
      env[key] = value
    }
  }

  if (!env.NO_PROXY && !env.no_proxy) {
    env.NO_PROXY = DEFAULT_NO_PROXY
  }
}

export async function resolveSystemProxyEnv(
  probeUrls: readonly string[] = DEFAULT_SYSTEM_PROXY_PROBE_URLS
): Promise<NodeJS.ProcessEnv> {
  if (process.env.LODY_ELECTRON_DISABLE_SYSTEM_PROXY_ENV === '1') {
    return {}
  }

  for (const probeUrl of probeUrls) {
    const resolved = await session.defaultSession.resolveProxy(probeUrl).catch(() => '')
    const proxyUrl = parseResolvedProxyRules(resolved)
    if (proxyUrl) {
      return {
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        ALL_PROXY: proxyUrl,
        NO_PROXY: DEFAULT_NO_PROXY
      }
    }
  }

  return {}
}

export function parseResolvedProxyRules(rules: string): string | undefined {
  for (const part of rules.split(';')) {
    const trimmed = part.trim()
    if (!trimmed || trimmed.toUpperCase() === 'DIRECT') {
      continue
    }

    const [kindRaw, ...rest] = trimmed.split(/\s+/u)
    const kind = kindRaw?.toUpperCase()
    const hostPort = rest.join('')
    if (!kind || !hostPort) {
      continue
    }

    if (kind === 'PROXY') {
      return toProxyUrl('http', hostPort)
    }
    if (kind === 'HTTPS') {
      return toProxyUrl('https', hostPort)
    }
  }

  return undefined
}

function toProxyUrl(protocol: 'http' | 'https', hostPort: string): string | undefined {
  try {
    const url = new URL(`${protocol}://${hostPort}`)
    if (!url.hostname) {
      return undefined
    }
    return `${url.protocol}//${url.host}`
  } catch {
    return undefined
  }
}

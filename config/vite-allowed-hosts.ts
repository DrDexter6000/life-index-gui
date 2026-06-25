type EnvMap = Record<string, string | undefined>;

export function resolveAllowedHosts(env: EnvMap = process.env): string[] {
  return env.LIFE_INDEX_ALLOW_TRYCLOUDFLARE_HOSTS === '1' ? ['.trycloudflare.com'] : [];
}

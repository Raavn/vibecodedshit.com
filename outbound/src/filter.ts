export const MIN_COMMITS = 20;
export const MAX_PUSH_AGE_DAYS = 30;
const HOSTED_SUFFIXES = ['lovable.app', 'vercel.app', 'netlify.app'];

/** Homepage on a custom domain: a valid http(s) URL whose host is not a free-tier hosting subdomain. */
export function hasCustomDomain(homepage: string | null | undefined): boolean {
  if (!homepage) return false;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(homepage) ? homepage : `https://${homepage}`);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes('.')) return false;
  return !HOSTED_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

export function pushedRecently(pushedAt: string, now: Date, days = MAX_PUSH_AGE_DAYS): boolean {
  const pushed = Date.parse(pushedAt);
  if (Number.isNaN(pushed)) return false;
  return now.getTime() - pushed <= days * 86_400_000;
}

const DEP_PATTERNS = [/^stripe$/, /^@stripe\//, /^@supabase\/supabase-js$/, /^@supabase\/auth-/, /^next-auth$/, /^@clerk\//];

/** Payments or auth: a known dependency in any package.json, or a file or route named `pricing`. */
export function hasPaymentsOrAuth(packageJsons: string[], paths: string[]): boolean {
  for (const raw of packageJsons) {
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(raw) as typeof pkg;
    } catch {
      continue;
    }
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    if (names.some((n) => DEP_PATTERNS.some((re) => re.test(n)))) return true;
  }
  return paths.some((p) => p.split('/').some((segment) => /^pricing(\.[a-z]+)?$/i.test(segment)));
}

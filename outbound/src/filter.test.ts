import { describe, expect, it } from 'vitest';
import { hasCustomDomain, hasPaymentsOrAuth, pushedRecently } from './filter.js';

describe('hasCustomDomain', () => {
  it('accepts a custom domain', () => {
    expect(hasCustomDomain('https://acme.io')).toBe(true);
    expect(hasCustomDomain('acme.io/app')).toBe(true);
  });
  it('rejects free hosting subdomains and empty values', () => {
    expect(hasCustomDomain('https://x.lovable.app')).toBe(false);
    expect(hasCustomDomain('https://x.vercel.app')).toBe(false);
    expect(hasCustomDomain('https://x.netlify.app')).toBe(false);
    expect(hasCustomDomain('')).toBe(false);
    expect(hasCustomDomain(null)).toBe(false);
    expect(hasCustomDomain('localhost')).toBe(false);
  });
});

describe('pushedRecently', () => {
  const now = new Date('2026-11-11T00:00:00Z');
  it('uses the 30 day window', () => {
    expect(pushedRecently('2026-10-20T00:00:00Z', now)).toBe(true);
    expect(pushedRecently('2026-09-01T00:00:00Z', now)).toBe(false);
    expect(pushedRecently('nonsense', now)).toBe(false);
  });
});

describe('hasPaymentsOrAuth', () => {
  it('finds a payments or auth dependency in any package.json', () => {
    expect(hasPaymentsOrAuth([JSON.stringify({ dependencies: { stripe: '1' } })], [])).toBe(true);
    expect(hasPaymentsOrAuth([JSON.stringify({ dependencies: { '@supabase/supabase-js': '2' } })], [])).toBe(true);
    expect(hasPaymentsOrAuth(['not json', JSON.stringify({ devDependencies: { '@clerk/nextjs': '1' } })], [])).toBe(true);
  });
  it('finds a pricing file or route', () => {
    expect(hasPaymentsOrAuth([], ['src/pages/Pricing.tsx'])).toBe(true);
    expect(hasPaymentsOrAuth([], ['app/pricing/page.tsx'])).toBe(true);
  });
  it('rejects a plain app', () => {
    expect(hasPaymentsOrAuth([JSON.stringify({ dependencies: { react: '19' } })], ['src/App.tsx', 'src/pricing-table.ts'])).toBe(false);
  });
});

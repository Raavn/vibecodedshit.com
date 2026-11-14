import { describe, expect, it } from 'vitest';
import { outboundPackageCache } from './scan.js';

describe('outboundPackageCache', () => {
  it('keeps install caches apart from the shared health cache', () => {
    expect(outboundPackageCache({}, '/home/u')).toBe('/home/u/.cache/health/outbound-packages');
  });
  it('follows XDG_CACHE_HOME', () => {
    expect(outboundPackageCache({ XDG_CACHE_HOME: '/xdg' }, '/home/u')).toBe('/xdg/health/outbound-packages');
  });
  it('lets HEALTH_PACKAGE_CACHE win, including off', () => {
    expect(outboundPackageCache({ HEALTH_PACKAGE_CACHE: 'off' }, '/home/u')).toBe('off');
    expect(outboundPackageCache({ HEALTH_PACKAGE_CACHE: '/c' }, '/home/u')).toBe('/c');
  });
});

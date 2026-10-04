import { describe, expect, it } from 'vitest';
import { parseIni } from './ini.js';

describe('parseIni', () => {
  it('reads sections, both separators, comments and continuation lines', () => {
    const parsed = parseIni(
      ['top = 1', '; a comment', '[mypy]', 'strict = True', 'plugins: a,', '  b', '# another', '', '[mypy-foo.*]', 'ignore_errors = true', '[empty]'].join('\n'),
    );
    expect(parsed['']).toEqual({ top: '1' });
    expect(parsed.mypy).toEqual({ strict: 'True', plugins: 'a,\nb' });
    expect(parsed['mypy-foo.*']).toEqual({ ignore_errors: 'true' });
    expect(parsed.empty).toEqual({});
  });
});

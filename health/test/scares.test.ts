import { describe, expect, it } from 'vitest';
import { supabaseRoleOf } from '../src/measure/p5-4.js';
import { buildScares, scareLines, unchecked } from '../src/report/scares.js';
import { renderReport } from '../src/report/render.js';
import { loadMethodology } from '../src/methodology/load.js';
import { makeRun } from './helpers/run.js';

const b64 = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: object): string => `eyJhbGciOiJIUzI1NiJ9.${b64(claims)}.sig_nature`;
const methodology = loadMethodology('1.0');

const param = (id: string, score: number) => ({ id, status: 'measured' as const, weight: 1, score });

describe('supabaseRoleOf', () => {
  it('reads the role of a Supabase JWT and nothing else', () => {
    expect(supabaseRoleOf(`KEY="${jwt({ iss: 'supabase', role: 'service_role' })}"`)).toBe('service_role');
    expect(supabaseRoleOf(`KEY="${jwt({ iss: 'supabase', role: 'anon' })}"`)).toBe('anon');
    expect(supabaseRoleOf(`KEY="${jwt({ iss: 'auth0', role: 'service_role' })}"`)).toBeNull();
    expect(supabaseRoleOf('KEY=eyJbroken.eyJnotjson.x')).toBeNull();
  });

  it('recognises the sb_ key prefixes', () => {
    expect(supabaseRoleOf('K=sb_secret_abc123')).toBe('service_role');
    expect(supabaseRoleOf('K=sb_publishable_abc123')).toBe('anon');
  });
});

describe('buildScares', () => {
  it('puts the Supabase service-role scare first and caps the list at 3', () => {
    const run = makeRun({
      parameters: [param('5.4', 0), param('5.1', 20), param('6.4', 0), param('1.1', 0)],
      reportOnly: {
        secretsInTree: [
          { ruleId: 'jwt', file: 'a.env', line: 1, supabaseRole: 'service_role' },
          { ruleId: 'aws', file: 'b.env', line: 2, supabaseRole: null },
        ],
        secretsInHistory: { count: 0, findings: [] },
        productionDependencyVulnerabilities: { points: 10, advisories: [{ name: 'lodash', version: '1.0.0', severity: 'critical' }] },
      },
    });
    const scares = buildScares(run);
    expect(scares).toHaveLength(3);
    expect(scares[0]).toBe('Anyone with access to your git repo can read and change all the data in your Supabase.');
    expect(scares[1]).toContain('b.env');
    expect(scares[2]).toContain('lodash 1.0.0');
  });

  it('does not raise a Supabase scare or a secret scare for an anon key', () => {
    const run = makeRun({
      parameters: [param('5.4', 0)],
      reportOnly: { secretsInTree: [{ ruleId: 'jwt', file: 'a.env', line: 1, supabaseRole: 'anon' }] },
    });
    expect(buildScares(run)).toEqual([]);
  });

  it('counts a secret in the tree and in history once', () => {
    const run = makeRun({
      parameters: [param('5.4', 0)],
      reportOnly: {
        secretsInTree: [{ ruleId: 'aws', file: 'b.env', line: 2, supabaseRole: null }],
        secretsInHistory: { count: 2, findings: [{ ruleId: 'aws', file: 'b.env', commit: 'c1' }, { ruleId: 'aws', file: 'old.env', commit: 'c2' }] },
      },
    });
    const scares = buildScares(run);
    expect(scares).toHaveLength(2);
    expect(scares[1]).toContain('a secret is still readable');
  });

  it('is empty for a clean run, prints Scare: lines, and says what was not checked', () => {
    const run = makeRun({ parameters: [] });
    expect(buildScares(run)).toEqual([]);
    expect(unchecked(run)).toEqual(['secrets', 'dependency advisories']);
    const html = renderReport(run, methodology);
    expect(html).toContain('<h2>Top scares</h2>');
    expect(html).toContain('not a clean bill of health');
    expect(scareLines(makeRun({ parameters: [param('6.4', 0)] }))).toEqual(['Scare: Nothing stops broken code from reaching main.']);
  });

  it('never puts a token in the report', () => {
    const token = jwt({ iss: 'supabase', role: 'service_role' });
    const run = makeRun({ parameters: [param('5.4', 0)], reportOnly: { secretsInTree: [{ ruleId: 'jwt', file: 'a.env', line: 1, supabaseRole: 'service_role' }] } });
    expect(renderReport(run, methodology)).not.toContain(token);
    expect(JSON.stringify(run)).not.toContain(token);
  });
});

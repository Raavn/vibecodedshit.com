import { describe, expect, it } from 'vitest';
import type { RunFile } from '../../health/src/run/schema.js';
import { runSummary, topFinding } from './finding.js';

function run(reportOnly: Record<string, unknown>, parameters: RunFile['parameters'] = []): RunFile {
  return {
    schemaVersion: 1,
    valid: true,
    warnings: [],
    methodology: { version: '1.0' },
    mode: 'preview',
    comparable: false,
    asOf: '2026-11-11',
    layers: ['static'],
    repo: { path: '/tmp/secret-path', headCommit: null, treeHash: null },
    tools: { health: '0', node: '0', typescript: '0', git: '0' },
    reportOnly,
    ignoreSet: { healthignoreSha256: null, gitleaksignoreSha256: null, excludedLinesPercent: 0 },
    scope: { logicFiles: 1, logicLines: 1, sourceLines: 1, packages: [] },
    parameters: [{ id: '5.4', status: 'measured', weight: 1, score: 0, raw: { kind: 'number', value: 1 } }, ...parameters],
    dimensions: [{ id: 5, key: 'security', score: 10 }],
    breakdown: { byPackage: {}, byGroup: {} },
    health: { score: 40, displayed: 40, band: 'Fragile' },
  };
}

describe('topFinding', () => {
  it('ranks a Supabase service_role key first with its file and line', () => {
    const f = topFinding(
      run({
        secretsInTree: [
          { ruleId: 'generic-api-key', file: 'a.ts', line: 3, supabaseRole: null },
          { ruleId: 'supabase', file: 'src/client.ts', line: 7, supabaseRole: 'service_role' },
        ],
      }),
    );
    expect(f).toMatchObject({ severityRank: 1, findingParam: '5.4', findingFile: 'src/client.ts', findingLine: 7 });
    expect(f?.riskSentence).toContain('Supabase');
  });

  it('ignores a public anon key', () => {
    expect(topFinding(run({ secretsInTree: [{ ruleId: 'supabase', file: 'a.ts', line: 1, supabaseRole: 'anon' }] }))).toBeNull();
  });

  it('ranks another committed secret second', () => {
    const f = topFinding(run({ secretsInTree: [{ ruleId: 'stripe-access-token', file: '.env', line: 2, supabaseRole: null }] }));
    expect(f).toMatchObject({ severityRank: 2, findingFile: '.env', findingLine: 2 });
  });

  it('ranks a low-scoring dependency check third, with the worst advisory and no file', () => {
    const f = topFinding(
      run(
        {
          productionDependencyVulnerabilities: {
            advisories: [
              { name: 'lodash', version: '4.0.0', severity: 'low' },
              { name: 'next', version: '13.0.0', severity: 'critical' },
            ],
          },
        },
        [{ id: '5.1', status: 'measured', weight: 1, score: 20 }],
      ),
    );
    expect(f).toMatchObject({ severityRank: 3, findingParam: '5.1', findingFile: null, findingLine: null, findingDetail: 'next 13.0.0' });
  });

  it('returns null when only non-business scares fire', () => {
    expect(topFinding(run({}, [{ id: '1.1', status: 'failed', weight: 1, score: 0 }]))).toBeNull();
  });
});

describe('runSummary', () => {
  it('keeps scores and statuses, not paths', () => {
    const summary = JSON.stringify(runSummary(run({}), 'LOVABLE'));
    expect(summary).not.toContain('secret-path');
    expect(summary).toContain('LOVABLE');
  });
});

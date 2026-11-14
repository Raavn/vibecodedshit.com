import { describe, expect, it } from 'vitest';
import { footer, imageBuildCommand } from '../src/commands/footer.js';
import type { RunFile } from '../src/run/schema.js';

const run = (over: Partial<RunFile>): RunFile => ({ valid: true, mode: 'full', comparable: true, parameters: [], ...over }) as RunFile;

describe('scan footer', () => {
  it('says what a preview skipped and that only full runs can be submitted', () => {
    const text = footer(
      run({
        mode: 'preview',
        comparable: false,
        parameters: [
          { id: '6.1', status: 'not_measured', reason: 'execution layer (preview)' },
          { id: '4.2', status: 'measured' },
        ] as RunFile['parameters'],
      }),
      '/tmp/run.json',
    );
    expect(text).toContain('Skipped (needs Docker): 6.1.');
    expect(text).toContain('Your code stayed on this machine.');
    expect(text).toContain('Only full, comparable runs');
    expect(text).not.toContain('npx vibecodedshit submit');
  });

  it('prints the submit command after a comparable full run', () => {
    const text = footer(run({}), '/tmp/run.json');
    expect(text).toContain('npx vibecodedshit submit /tmp/run.json --email <you@example.com>');
    expect(text).toContain('--confirm');
  });

  it('builds the image from the package root', () => {
    expect(imageBuildCommand('/pkg', 'health:1.0')).toBe('docker build -t health:1.0 -f /pkg/docker/Dockerfile /pkg/docker');
  });
});

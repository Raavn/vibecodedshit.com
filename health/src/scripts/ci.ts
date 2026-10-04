import path from 'node:path';
import { parse } from 'yaml';
import { readTracked, trackedPaths } from '../scope/tracked.js';
import type { CiCommand, CiFormat } from './types.js';

/** The five CI files of methodology 3.1 `ci_files`. */
function ciFormatOf(file: string): CiFormat | undefined {
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) return 'github';
  if (file === '.gitlab-ci.yml') return 'gitlab';
  if (file === '.circleci/config.yml') return 'circleci';
  if (file === 'bitbucket-pipelines.yml') return 'bitbucket';
  if (file === 'azure-pipelines.yml') return 'azure';
  return undefined;
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value);

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return [];
}

function workingDir(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? path.posix.normalize(value.trim().replace(/^\.\//, '')) : '.';
}

function withCd(command: string, dir: string): string {
  const match = /^\s*cd\s+([^\s&;|"'$`]+)\s*&&/.exec(command);
  return match?.[1] ? path.posix.normalize(path.posix.join(dir, match[1])) : dir;
}

function collect(doc: unknown, file: string, format: CiFormat, out: CiCommand[]): void {
  const push = (job: string, command: string, dir: string): void => {
    if (command.trim() === '') return;
    out.push({ file, format, job, command, dir: withCd(command, dir) });
  };
  if (!isObj(doc)) return;
  if (format === 'github' || format === 'circleci') {
    const jobs = isObj(doc.jobs) ? doc.jobs : {};
    for (const [name, job] of Object.entries(jobs)) {
      if (!isObj(job)) continue;
      const defaults = isObj(job.defaults) && isObj(job.defaults.run) ? workingDir(job.defaults.run['working-directory']) : '.';
      const steps = Array.isArray(job.steps) ? job.steps : [];
      for (const step of steps) {
        if (format === 'github') {
          if (!isObj(step) || typeof step.run !== 'string') continue;
          push(name, step.run, step['working-directory'] === undefined ? defaults : workingDir(step['working-directory']));
        } else {
          const run = isObj(step) ? step.run : undefined;
          const command = typeof run === 'string' ? run : isObj(run) && typeof run.command === 'string' ? run.command : undefined;
          if (command !== undefined) push(name, command, '.');
        }
      }
    }
  } else if (format === 'gitlab') {
    for (const [name, value] of Object.entries(doc)) {
      if (!isObj(value)) continue;
      for (const key of ['before_script', 'script', 'after_script']) for (const command of strings(value[key])) push(name, command, '.');
    }
  } else if (format === 'bitbucket') {
    const walk = (node: unknown, name: string): void => {
      if (Array.isArray(node)) node.forEach((child) => walk(child, name));
      else if (isObj(node)) {
        for (const [key, child] of Object.entries(node)) {
          if (key === 'script') for (const command of strings(child)) push(name, command, '.');
          else walk(child, key === 'name' || typeof child !== 'object' ? name : key);
        }
      }
    };
    walk(doc.pipelines, 'pipelines');
  } else {
    const walk = (node: unknown, name: string): void => {
      if (Array.isArray(node)) node.forEach((child) => walk(child, name));
      else if (isObj(node)) {
        for (const [key, child] of Object.entries(node)) {
          if (key === 'steps' && Array.isArray(child)) {
            for (const step of child) {
              if (!isObj(step)) continue;
              for (const field of ['script', 'bash', 'pwsh', 'powershell']) {
                if (typeof step[field] === 'string') push(name, step[field], workingDir(step.workingDirectory));
              }
            }
          } else walk(child, typeof node.job === 'string' ? node.job : name);
        }
      }
    };
    walk(doc, 'steps');
  }
}

/** Every command of the repository's CI files. Invalid YAML is skipped with a warning. */
export function ciCommands(repoPath: string, warnings: string[] = []): CiCommand[] {
  const out: CiCommand[] = [];
  for (const file of trackedPaths(repoPath)) {
    const format = ciFormatOf(file);
    if (!format) continue;
    const text = readTracked(repoPath, file);
    if (text === null) continue;
    let doc: unknown;
    try {
      doc = parse(text);
    } catch (err) {
      warnings.push(`${file}: invalid YAML, skipped (${err instanceof Error ? err.message.split('\n')[0] : String(err)})`);
      continue;
    }
    collect(doc, file, format, out);
  }
  return out;
}

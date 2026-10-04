import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';
import picomatch from 'picomatch';
import type ts from 'typescript';
import type { Methodology } from '../methodology/load.js';
import { analyzePythonFiles, pythonVersion } from '../python/scope.js';
import { detectPackages, packageOf } from './packages.js';
import { hasGeneratedMarker, looksMinified, physicalLines } from './rules.js';
import { analyzeTsFile, parseTsFile } from './ts-lines.js';
import {
  ToolError,
  type Group,
  type Language,
  type Role,
  type Scope,
  type ScopedFile,
} from './types.js';

export class NotAGitRepositoryError extends Error {
  constructor(repoPath: string) {
    super(`${repoPath} is not a git repository`);
    this.name = 'NotAGitRepositoryError';
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function readIfPresent(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function trackedFiles(repoPath: string): string[] {
  const result = spawnSync('git', ['-C', repoPath, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new NotAGitRepositoryError(repoPath);
  return result.stdout.split('\0').filter((entry) => entry !== '');
}

function languageOf(file: string, methodology: Methodology): Language | null {
  const ext = path.posix.extname(file).toLowerCase();
  const { extensions } = methodology.scope.source_files;
  if (extensions.typescript.includes(ext)) return 'typescript';
  if (extensions.javascript.includes(ext)) return 'javascript';
  if (extensions.python.includes(ext)) return 'python';
  return null;
}

function groupOf(language: Language): Group {
  return language === 'python' ? 'python' : 'typescript_javascript';
}

/** Glob entries only: scope.yaml mixes globs with prose rules, which are code in rules.ts. */
function globsOnly(entries: string[]): string[] {
  return entries.filter((entry) => !/\s/.test(entry));
}

export async function buildScope(repoPath: string, methodology: Methodology): Promise<Scope> {
  const cfg = methodology.scope;
  const tracked = trackedFiles(repoPath);

  const fixedGlobs = [
    ...cfg.exclusions.vendored,
    ...cfg.exclusions.build_output,
    ...cfg.exclusions.generated,
    ...cfg.exclusions.minified,
    ...cfg.exclusions.migrations,
    ...cfg.exclusions.declarations,
  ].filter((entry) => !/\s/.test(entry));
  const isFixedExcluded = picomatch(fixedGlobs, { dot: true });
  const isTest = {
    typescript_javascript: picomatch(globsOnly(cfg.file_roles.test.typescript_javascript), { dot: true }),
    python: picomatch(globsOnly(cfg.file_roles.test.python), { dot: true }),
  };
  const isConfig = picomatch(globsOnly(cfg.file_roles.config), { dot: true });

  const healthignoreText = readIfPresent(path.join(repoPath, '.healthignore'));
  const healthignore = healthignoreText === null ? null : ignore().add(healthignoreText);
  const gitleaksText = readIfPresent(path.join(repoPath, '.gitleaksignore'));

  const afterFixed = tracked.filter((file) => !isFixedExcluded(file));
  const packages = detectPackages(repoPath, afterFixed);

  const warnings: string[] = [];
  let ignoredLines = 0;
  let sourceExtLines = 0;

  interface Candidate {
    file: string;
    language: Language;
    text: string;
  }
  const candidates: Candidate[] = [];

  for (const file of afterFixed) {
    const language = languageOf(file, methodology);
    if (!language) continue;
    const text = readIfPresent(path.join(repoPath, file));
    if (text === null) continue; // tracked but deleted in the working tree
    const normalized = text.replace(/\r\n?/g, '\n');
    if (hasGeneratedMarker(normalized) || looksMinified(normalized)) continue;
    const lines = physicalLines(normalized);
    sourceExtLines += lines;
    if (healthignore?.ignores(file)) {
      ignoredLines += lines;
      continue;
    }
    candidates.push({ file, language, text: normalized });
  }

  const pyFiles = candidates.filter((c) => c.language === 'python').map((c) => c.file);
  const pyInfo = analyzePythonFiles(repoPath, pyFiles);
  const pyVersion = pyFiles.length > 0 ? pythonVersion() : undefined;

  const tsCache = new Map<string, ts.SourceFile>();
  const textByPath = new Map(candidates.map((c) => [c.file, c.text]));
  const files: ScopedFile[] = [];

  for (const { file, language, text } of candidates) {
    const group = groupOf(language);
    const base = { path: file, language, group, package: packageOf(file, packages) };
    let role: Role | null;
    let codeLines: number;

    if (isTest[group](file)) {
      role = 'test';
    } else if (isConfig(file)) {
      role = 'config';
    } else {
      role = null; // decided below from whether the file defines anything callable
    }

    if (group === 'python') {
      const info = pyInfo[file];
      if (!info) throw new ToolError(`scope_helper.py returned nothing for ${file}`);
      if (!info.parsed) warnings.push(`Python file ${file} did not parse; counted non-blank lines not starting with #`);
      codeLines = info.lines;
      if (role === null) role = info.hasDef ? 'logic' : null;
    } else {
      const info = analyzeTsFile(file, text);
      tsCache.set(file, info.sourceFile);
      codeLines = info.codeLines;
      if (role === null) role = info.definesCallable ? 'logic' : null;
    }
    if (role === null) continue; // barrels, type-only and constant-only files are not logic files

    files.push({
      ...base,
      role,
      logicLines: role === 'logic' ? codeLines : 0,
      sourceLines: role === 'logic' || role === 'test' ? codeLines : 0,
    });
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const logic = files.filter((f) => f.role === 'logic');
  const usedPackages = [...new Set(files.map((f) => f.package))].sort();

  return {
    files,
    excludedLinesPercent: sourceExtLines === 0 ? 0 : (ignoredLines / sourceExtLines) * 100,
    packages: usedPackages,
    logicFiles: logic.length,
    logicLines: logic.reduce((sum, f) => sum + f.logicLines, 0),
    sourceLines: files.reduce((sum, f) => sum + f.sourceLines, 0),
    warnings,
    healthignoreSha256: healthignoreText === null ? null : sha256(healthignoreText),
    gitleaksignoreSha256: gitleaksText === null ? null : sha256(gitleaksText),
    ...(pyVersion === undefined ? {} : { pythonVersion: pyVersion }),
    getTsSourceFile(file: string): ts.SourceFile {
      const cached = tsCache.get(file);
      if (cached) return cached;
      const text = textByPath.get(file);
      if (text === undefined) throw new Error(`${file} is not an in-scope TypeScript or JavaScript file`);
      const parsed = parseTsFile(file, text);
      tsCache.set(file, parsed);
      return parsed;
    },
  };
}

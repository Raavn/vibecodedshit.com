import type ts from 'typescript';

export type Language = 'typescript' | 'javascript' | 'python';
export type Group = 'typescript_javascript' | 'python';
export type Role = 'logic' | 'test' | 'config';

export interface ScopedFile {
  /** Repo-relative, posix separators. */
  path: string;
  language: Language;
  group: Group;
  /** Nearest workspace package directory, or ".". */
  package: string;
  role: Role;
  /** Non-blank, non-comment lines when role is logic, otherwise 0. */
  logicLines: number;
  /** Non-blank, non-comment lines when role is logic or test, otherwise 0. */
  sourceLines: number;
}

export interface Scope {
  files: ScopedFile[];
  /** Physical lines removed by .healthignore / physical lines of source files that survived the fixed exclusions. */
  excludedLinesPercent: number;
  /** Packages that contain at least one scoped file. */
  packages: string[];
  logicFiles: number;
  logicLines: number;
  sourceLines: number;
  warnings: string[];
  healthignoreSha256: string | null;
  gitleaksignoreSha256: string | null;
  /** Python version, set when Python files were parsed. */
  pythonVersion?: string;
  getTsSourceFile(path: string): ts.SourceFile;
}

/** A failure of the tool itself (missing interpreter, crashed helper), not of the scanned repository. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

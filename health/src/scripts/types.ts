export type CiFormat = 'github' | 'gitlab' | 'circleci' | 'bitbucket' | 'azure';

/** Whether a CI job is triggered on pull requests, merge requests or non-default pushes. Filled by 6.4; 3.1 ignores it. */
export interface CiTriggers {
  qualifies: boolean;
  why: string;
}

export interface CiCommand {
  file: string;
  format: CiFormat;
  job: string;
  command: string;
  /** Repo-relative working directory: "." unless the step sets `working-directory` or the command starts with `cd <literal> &&`. */
  dir: string;
  triggers?: CiTriggers;
}

export interface ResolvedCommand {
  tool: string | null;
  argv: string[];
  file: string;
  /** The entries read to reach the command, for example `Makefile:check`, `package.json:verify`. */
  chain: string[];
  /** The chain length. */
  depth: number;
  /** For `tox` and `nox` calls kept as a plain command: a tox or nox file of the call's directory could be read. */
  readable?: boolean;
}

export interface EntryPointKind {
  id: string;
  /** Every entry point defined by the file of this kind in exactly `dir` (no ancestor search). `invoke` is the call text `expandCommand` understands. */
  list(repoPath: string, dir: string): { name: string; invoke: string }[];
  lookup(repoPath: string, dir: string, name: string): { file: string; bodies: string[] } | undefined;
  /** The file of this kind a call in `dir` would read, when there is one. Only the kinds that need it (tox, nox) define it. */
  fileFor?(repoPath: string, dir: string): string | undefined;
}

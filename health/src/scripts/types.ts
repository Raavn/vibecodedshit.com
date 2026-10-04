export type CiFormat = 'github' | 'gitlab' | 'circleci' | 'bitbucket' | 'azure';

/** Filled only by the CI-trigger measurer (D6); absent for D3. */
export type CiTriggers = Record<string, unknown>;

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
}

export interface EntryPointKind {
  id: string;
  lookup(repoPath: string, dir: string, name: string): { file: string; bodies: string[] } | undefined;
}

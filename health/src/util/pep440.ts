/** The part of PEP 440 that dependency checks need: versions, ordering and specifiers. */

export interface PyVersion {
  epoch: number;
  release: number[];
  pre?: { kind: 'a' | 'b' | 'rc'; n: number };
  post?: number;
  dev?: number;
  local?: string;
}

const VERSION =
  /^\s*v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|alpha|b|beta|c|rc|pre|preview)[-_.]?(\d+)?)?(?:-(\d+)|[-_.]?(post|rev|r)[-_.]?(\d+)?)?(?:[-_.]?(dev)[-_.]?(\d+)?)?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?\s*$/;

export function parseVersion(text: string): PyVersion | undefined {
  const m = VERSION.exec(text.toLowerCase());
  if (!m) return undefined;
  const version: PyVersion = { epoch: Number(m[1] ?? 0), release: (m[2] ?? '0').split('.').map(Number) };
  if (m[3] !== undefined) {
    const label = m[3];
    const kind = label === 'a' || label === 'alpha' ? 'a' : label === 'b' || label === 'beta' ? 'b' : 'rc';
    version.pre = { kind, n: Number(m[4] ?? 0) };
  }
  if (m[5] !== undefined) version.post = Number(m[5]);
  else if (m[6] !== undefined) version.post = Number(m[7] ?? 0);
  if (m[8] !== undefined) version.dev = Number(m[9] ?? 0);
  if (m[10] !== undefined) version.local = m[10];
  return version;
}

function cmpNumbers(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

const PRE_RANK = { a: 0, b: 1, rc: 2 } as const;

/** Sort key for the pre/post/dev part, following the PEP 440 ordering rules. */
function phase(v: PyVersion): [number, number, number, number, number] {
  const pre = v.pre ? PRE_RANK[v.pre.kind] : v.post === undefined && v.dev !== undefined ? -1 : 3;
  const preN = v.pre ? v.pre.n : 0;
  const post = v.post === undefined ? -1 : v.post;
  const dev = v.dev === undefined ? Number.POSITIVE_INFINITY : v.dev;
  return [pre, preN, post, dev, 0];
}

export function compareVersions(a: PyVersion, b: PyVersion): number {
  if (a.epoch !== b.epoch) return a.epoch < b.epoch ? -1 : 1;
  const release = cmpNumbers(a.release, b.release);
  if (release !== 0) return release;
  const pa = phase(a);
  const pb = phase(b);
  for (let i = 0; i < pa.length; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  const la = a.local ?? '';
  const lb = b.local ?? '';
  return la === lb ? 0 : la < lb ? -1 : 1;
}

/** A stable release: no pre-release and no dev part (post releases are stable). */
export function isStable(v: PyVersion): boolean {
  return v.pre === undefined && v.dev === undefined;
}

function stripLocal(v: PyVersion): PyVersion {
  return { epoch: v.epoch, release: v.release, pre: v.pre, post: v.post, dev: v.dev };
}

interface Clause {
  op: string;
  version: string;
}

function parseClauses(specifier: string): Clause[] | undefined {
  const clauses: Clause[] = [];
  for (const part of specifier.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const m = /^(===|==|!=|<=|>=|~=|<|>)\s*(.+)$/.exec(trimmed);
    if (!m?.[1] || !m[2]) return undefined;
    clauses.push({ op: m[1], version: m[2].trim() });
  }
  return clauses;
}

function clauseHolds(version: PyVersion, raw: string, clause: Clause): boolean {
  const wildcard = clause.version.endsWith('.*');
  const target = parseVersion(wildcard ? clause.version.slice(0, -2) : clause.version);
  if (!target) return false;
  const a = stripLocal(version);
  switch (clause.op) {
    case '===':
      return raw.trim().toLowerCase() === clause.version.toLowerCase();
    case '==':
    case '!=': {
      let equal: boolean;
      if (wildcard) {
        equal = a.epoch === target.epoch && target.release.every((n, i) => (a.release[i] ?? 0) === n);
      } else {
        equal = compareVersions(target.local ? version : a, target) === 0;
      }
      return clause.op === '==' ? equal : !equal;
    }
    case '<=':
      return compareVersions(a, target) <= 0;
    case '>=':
      return compareVersions(a, target) >= 0;
    case '<':
      return compareVersions(a, target) < 0 && !(target.pre === undefined && a.pre !== undefined && cmpNumbers(a.release, target.release) === 0);
    case '>':
      return compareVersions(a, target) > 0 && !(target.post === undefined && a.post !== undefined && cmpNumbers(a.release, target.release) === 0);
    case '~=': {
      if (target.release.length < 2) return false;
      const prefix = target.release.slice(0, -1);
      if (compareVersions(a, target) < 0) return false;
      return a.epoch === target.epoch && prefix.every((n, i) => (a.release[i] ?? 0) === n);
    }
    default:
      return false;
  }
}

/** Is this text a well-formed specifier set ('' is valid and means any version)? */
export function isValidSpecifier(specifier: string): boolean {
  return parseClauses(specifier) !== undefined;
}

/** Does `version` satisfy a PEP 440 specifier set? An empty specifier accepts everything. */
export function satisfies(version: string, specifier: string): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const clauses = parseClauses(specifier);
  if (!clauses) return false;
  return clauses.every((clause) => clauseHolds(parsed, version, clause));
}

/** `^1.2.3` and `~1.2.3` (Poetry) to a PEP 440 specifier set; other constraints pass through. */
export function poetryToPep440(constraint: string): string {
  const text = constraint.trim();
  if (text === '' || text === '*') return '';
  return text
    .split(',')
    .map((part) => part.trim())
    .map((part) => {
      const m = /^([\^~])\s*(\d+(?:\.\d+)*)/.exec(part);
      if (!m?.[2]) return /^\d/.test(part) ? `==${part}` : part;
      const nums = m[2].split('.').map(Number);
      let upper: number[];
      if (m[1] === '^') {
        const index = nums.findIndex((n) => n !== 0);
        const at = index === -1 ? nums.length - 1 : index;
        upper = nums.slice(0, at + 1);
        upper[at] = (upper[at] ?? 0) + 1;
      } else {
        upper = nums.length === 1 ? [(nums[0] ?? 0) + 1] : [nums[0] ?? 0, (nums[1] ?? 0) + 1];
      }
      return `>=${nums.join('.')},<${upper.join('.')}`;
    })
    .join(',');
}

/** PEP 503 name normalization. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

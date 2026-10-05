// The methodology's 2.5 ESLint ruleset. Used with `eslint -c`, so a repository's own config is never read.
import { buildConfig } from './eslint.rules.mjs';

export default buildConfig({ typeAware: true });

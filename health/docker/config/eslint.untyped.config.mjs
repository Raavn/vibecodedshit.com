// The 2.5 ESLint ruleset without type information. health-eslint relints TypeScript files outside every tsconfig with it.
import { buildConfig } from './eslint.rules.mjs';

export default buildConfig({ typeAware: false });

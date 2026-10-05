// The methodology's 2.5 ESLint ruleset, shared by eslint.config.mjs (typed) and eslint.untyped.config.mjs (no type information).
import { readFileSync } from 'node:fs';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

function dependsOnReact() {
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    return Boolean({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }.react);
  } catch {
    return false;
  }
}

const core = {
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-self-compare': 'error',
  'no-unsafe-finally': 'error',
  'no-fallthrough': 'error',
  'no-cond-assign': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-self-assign': 'error',
  'getter-return': 'error',
  'no-async-promise-executor': 'error',
  'no-constant-binary-expression': 'error',
};

const typed = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];

/** `typeAware: false` is the second pass for TypeScript files outside every tsconfig: no projectService, no type-aware rules. */
export function buildConfig({ typeAware }) {
  return [
    { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**'] },
    {
      files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
      languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      linterOptions: { reportUnusedDisableDirectives: 'off', noInlineConfig: true },
      rules: { ...core, 'no-unused-vars': 'error' },
    },
    {
      files: typed,
      ...(typeAware ? { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: process.cwd() } } } : {}),
      plugins: { '@typescript-eslint': tseslint.plugin },
      rules: {
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': 'error',
        ...(typeAware
          ? {
              '@typescript-eslint/no-floating-promises': 'error',
              '@typescript-eslint/no-misused-promises': 'error',
              '@typescript-eslint/await-thenable': 'error',
            }
          : {}),
      },
    },
    ...(dependsOnReact()
      ? [{ files: ['**/*.{js,jsx,ts,tsx}'], plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error' } }]
      : []),
  ];
}

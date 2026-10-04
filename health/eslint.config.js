import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['test/fixtures/**', 'dist/**', 'node_modules/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
);

import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

// QA lint configuration: correctness rules only (no style opinions), so a finding is a likely bug.
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18.3' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/jsx-key': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-undef': 'error',
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'react/no-unescaped-entities': 'warn', // existing pages use raw quotes; they render correctly
      'react/no-direct-mutation-state': 'error',
    },
  },
  { files: ['api/**/*.js', 'qa/**/*.mjs', 'middleware.js', 'vite.config.js', 'tailwind.config.js', 'postcss.config.js', 'eslint.config.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } } },
  { files: ['**/*.test.js'], languageOptions: { globals: { ...globals.node } } },
]

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import unusedImports from 'eslint-plugin-unused-imports';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';

export default tseslint.config(
    // Global ignores
    {
        ignores: ['dist/**', 'node_modules/**', '*.cjs', '*.js']
    },

    // Base: ESLint recommended
    js.configs.recommended,

    // TypeScript recommended (replaces @typescript-eslint/eslint-plugin + parser)
    ...tseslint.configs.recommended,

    // Vue essential rules
    ...pluginVue.configs['flat/essential'],

    // Main config for TS + Vue files
    {
        files: ['src/**/*.ts', 'src/**/*.vue'],
        plugins: {
            'unused-imports': unusedImports,
            'import-x': importX,
        },
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.vue'],
            },
        },
        settings: {
            'import-x/resolver': {
                typescript: true,
            }
        },
        rules: {
            // TypeScript handles undefined variable checks — disable ESLint's no-undef
            'no-undef': 'off',

            'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
            'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
            semi: ['error', 'always', { omitLastInOneLineBlock: true }],
            'space-before-function-paren': ['error', 'never'],
            '@typescript-eslint/no-explicit-any': 'off',
            'vue/multi-word-component-names': 'off',
            indent: ['error', 4],

            // Bug-catching rules
            'no-shadow': 'off',
            '@typescript-eslint/no-shadow': 'warn',
            'no-unused-expressions': 'error',
            'no-self-compare': 'error',
            'no-template-curly-in-string': 'warn',
            eqeqeq: ['warn', 'smart'],
            'no-throw-literal': 'error',
            'no-void': 'off',

            // Unused imports - auto-fixable
            '@typescript-eslint/no-unused-vars': 'off',
            'unused-imports/no-unused-imports': 'warn',
            'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

            // Import rules - detect circular dependencies
            'import-x/no-cycle': ['error', { maxDepth: 5 }],
            'import-x/no-self-import': 'error',

            // Type-aware rules (require parserOptions.projectService)
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/require-await': 'warn',

            // Complexity limits
            complexity: ['error', { max: 15 }],
            'max-depth': ['error', 4],

            // Length limits
            'max-len': ['error', { code: 140, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
            'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
            'max-lines-per-function': ['error', { max: 250, skipBlankLines: true, skipComments: true }]
        }
    },

    // Vue files: use vue-eslint-parser with typescript-eslint as sub-parser
    {
        files: ['src/**/*.vue'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
                sourceType: 'module',
            }
        }
    },

    // Large renderer classes with many interrelated WebGL methods
    {
        files: ['**/renderer/**/*.ts'],
        rules: {
            'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }]
        }
    },

    // E2E tests often have long test functions with many assertions
    // and page.evaluate() callbacks that work with untyped browser globals
    {
        files: ['tests/e2e/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'max-lines-per-function': 'off',
            'max-depth': ['error', 5],
            'max-len': ['error', { code: 150, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }]
        }
    }
);

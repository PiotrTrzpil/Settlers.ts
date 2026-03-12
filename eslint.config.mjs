import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import unusedImports from 'eslint-plugin-unused-imports';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';

export default tseslint.config(
    // Global ignores
    {
        ignores: ['dist/**', 'node_modules/**', '*.cjs', '*.js', 'scripts/**/*.js']
    },

    // Base: ESLint recommended
    js.configs.recommended,

    // TypeScript strict (replaces recommended — adds no-invalid-void-type,
    // no-non-null-asserted-nullish-coalescing, prefer-literal-enum-member,
    // unified-signatures, no-extraneous-class, no-useless-constructor)
    ...tseslint.configs.strict,

    // Project style uses !. intentionally (getEntityOrThrow pattern) — disable globally
    { rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },

    // Vue essential rules
    ...pluginVue.configs['flat/essential'],

    // SonarJS: bug-detection focused rules
    sonarjs.configs.recommended,
    {
        rules: {
            // TODOs in code are legitimate development markers, not lint violations
            'sonarjs/todo-tag': 'off',
            // Irrelevant for a browser game (checks AWS security groups)
            'sonarjs/aws-restricted-ip-admin-access': 'off',
            // Redundant with @typescript-eslint/no-deprecated
            'sonarjs/deprecation': 'off',
        }
    },

    // Main config for TS + Vue files
    {
        files: ['src/**/*.ts', 'src/**/*.vue'],
        plugins: {
            'unused-imports': unusedImports,
            'import-x': importX,
            '@eslint-community/eslint-comments': eslintComments,
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
            '@typescript-eslint/no-explicit-any': 'off',
            'vue/multi-word-component-names': 'off',
            'no-void': 'off',

            // Rules moved to oxlint (much faster) — keep disabled here to avoid double-reporting
            semi: 'off',
            'space-before-function-paren': 'off',
            'no-shadow': 'off',
            'no-unused-expressions': 'off',
            'no-self-compare': 'off',
            'no-template-curly-in-string': 'off',
            eqeqeq: 'off',
            'no-throw-literal': 'off',
            complexity: 'off',
            'max-depth': 'off',
            'max-len': 'off',
            'max-lines': 'off',
            'max-lines-per-function': 'off',

            // @typescript-eslint/no-shadow kept — oxlint's no-shadow doesn't understand TS scopes
            '@typescript-eslint/no-shadow': 'warn',

            // Unused imports - auto-fixable (keep in ESLint for --fix support)
            '@typescript-eslint/no-unused-vars': 'off',
            'unused-imports/no-unused-imports': 'warn',
            'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

            // Import rules - detect circular dependencies
            'import-x/no-cycle': ['error', { maxDepth: 5 }],
            'import-x/no-self-import': 'error',

            // Type-aware rules moved to oxlint --type-aware
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/await-thenable': 'off',
            '@typescript-eslint/no-array-delete': 'off',

            // Type-aware rules kept in ESLint (not yet in oxlint)
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/require-await': 'warn',
            '@typescript-eslint/no-unnecessary-condition': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/no-deprecated': 'warn',

            // ESLint comments — require a description for every disable comment
            '@eslint-community/eslint-comments/require-description': 'warn',
            '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
            '@eslint-community/eslint-comments/no-unused-enable': 'error',
            '@eslint-community/eslint-comments/no-duplicate-disable': 'error',
            '@eslint-community/eslint-comments/disable-enable-pair': ['error', { allowWholeFile: true }],
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

    // E2E tests often have long test functions with many assertions
    // and page.evaluate() callbacks that work with untyped browser globals
    {
        files: ['tests/e2e/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            // Playwright tests naturally nest functions in page.evaluate() and callbacks
            'sonarjs/no-nested-functions': 'off',
            // Template literals in test assertions are often nested for clarity
            'sonarjs/no-nested-template-literals': 'off',
            // Ternaries in test helpers are idiomatic
            'sonarjs/no-nested-conditional': 'off',
            // E2E helpers tend to be complex state machines
            'sonarjs/cognitive-complexity': 'off',
        }
    },

    // Scripts and test setup use OS commands and crypto intentionally
    {
        files: ['tests/**/*.ts', 'scripts/**/*.ts'],
        rules: {
            // Test setup legitimately uses OS commands (launching browsers, etc.)
            'sonarjs/os-command': 'off',
            'sonarjs/no-os-command-from-path': 'off',
            // SHA-1 used for file checksums (integrity, not security)
            'sonarjs/hashing': 'off',
            // Nested templates common in test assertion strings
            'sonarjs/no-nested-template-literals': 'off',
            // Allow _-prefixed unused args in script helpers (intentional no-ops)
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        }
    },

    // Test mocks routinely cast partial objects via `as any`
    {
        files: ['tests/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        }
    },

    // Large Vue SFC files with template + script + styles
    {
        files: ['**/components/*-panel.vue', '**/views/*-view.vue'],
        rules: {
            'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }]
        }
    }
);

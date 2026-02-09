module.exports = {
    root: true,
    env: {
        node: true,
        browser: true,
        es2020: true
    },
    plugins: ['unused-imports', 'import'],
    extends: [
        'plugin:vue/vue3-essential',
        'eslint:recommended',
        '@vue/eslint-config-typescript'
    ],
    settings: {
        'import/resolver': {
            typescript: true,
            node: true
        }
    },
    parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
    },
    rules: {
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
        'import/no-cycle': ['error', { maxDepth: 5 }],
        'import/no-self-import': 'error',

        // Complexity limits
        'complexity': ['error', { max: 15 }],
        'max-depth': ['error', 4],

        // Length limits
        'max-len': ['error', { code: 140, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
        'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
        'max-lines-per-function': ['error', { max: 250, skipBlankLines: true, skipComments: true }]
    },
    overrides: [
        {
            files: ['*.js', '*.cjs'],
            env: {
                node: true
            }
        },
        {
            // Large renderer classes with many interrelated WebGL methods
            files: ['**/renderer/**/*.ts'],
            rules: {
                'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }]
            }
        },
        {
            // E2E tests often have long test functions with many assertions
            files: ['tests/e2e/**/*.ts'],
            rules: {
                'max-lines-per-function': 'off',
                'max-depth': ['error', 5],
                'max-len': ['error', { code: 150, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }]
            }
        }
    ]
};

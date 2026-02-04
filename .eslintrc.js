module.exports = {
    root: true,
    env: {
        node: true
    },
    extends: [
        'plugin:vue/vue3-essential',
        '@vue/standard',
        '@vue/typescript/recommended'
    ],
    parserOptions: {
        ecmaVersion: 2020,
        project: './tsconfig.json'
    },
    rules: {
        'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
        'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
        semi: ['error', 'always', { omitLastInOneLineBlock: true }],
        'space-before-function-paren': ['error', 'never'],
        '@typescript-eslint/no-explicit-any': 'off',
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
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

        // Type-checked rules (use TypeScript compiler for deeper analysis)
        '@typescript-eslint/no-floating-promises': 'warn',
        '@typescript-eslint/no-misused-promises': 'warn',
        '@typescript-eslint/await-thenable': 'warn',
        '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
        '@typescript-eslint/restrict-plus-operands': 'off'
    },
    overrides: [
        {
            files: [
                '**/__tests__/*.{j,t}s?(x)',
                '**/tests/unit/**/*.spec.{j,t}s?(x)'
            ],
            env: {
                mocha: true
            }
        },
        {
            // JS config files are not included in tsconfig.json
            files: ['*.js'],
            parserOptions: {
                project: null
            },
            rules: {
                '@typescript-eslint/no-floating-promises': 'off',
                '@typescript-eslint/no-misused-promises': 'off',
                '@typescript-eslint/await-thenable': 'off',
                '@typescript-eslint/no-unnecessary-type-assertion': 'off',
                '@typescript-eslint/restrict-plus-operands': 'off'
            }
        }
    ]
};

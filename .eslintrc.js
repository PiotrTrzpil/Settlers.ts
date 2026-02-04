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
        ecmaVersion: 2020
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
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
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
        }
    ]
};

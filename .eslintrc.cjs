module.exports = {
    root: true,
    env: {
        node: true,
        browser: true,
        es2020: true
    },
    plugins: ['unused-imports'],
    extends: [
        'plugin:vue/vue3-essential',
        'eslint:recommended',
        '@vue/eslint-config-typescript'
    ],
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
        'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    },
    overrides: [
        {
            files: ['*.js', '*.cjs'],
            env: {
                node: true
            }
        }
    ]
};

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'no-circular',
            severity: 'error',
            comment: 'Circular dependencies make code harder to understand and test',
            from: {},
            to: {
                circular: true
            }
        },
        {
            name: 'no-orphans',
            severity: 'warn',
            comment: 'Orphan modules are not imported from anywhere and may be dead code',
            from: {
                orphan: true,
                pathNot: [
                    '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$', // dotfiles
                    '\\.d\\.ts$',                            // TypeScript declaration files
                    '(^|/)tsconfig\\.json$',
                    '(^|/)vite\\.config\\.',
                    '^src/main\\.ts$',                       // entry point
                    '^src/types/'                            // type declarations
                ]
            },
            to: {}
        },
        {
            name: 'game-no-ui-imports',
            severity: 'error',
            comment: 'Game logic should not depend on Vue components or views',
            from: {
                path: '^src/game/'
            },
            to: {
                path: '^src/(components|views)/'
            }
        },
        {
            name: 'resources-no-game-imports',
            severity: 'error',
            comment: 'Resource loaders should be standalone and not depend on game logic',
            from: {
                path: '^src/resources/'
            },
            to: {
                path: '^src/game/'
            }
        },
        {
            name: 'utilities-standalone',
            severity: 'error',
            comment: 'Utilities should be standalone and not import from other src modules',
            from: {
                path: '^src/utilities/'
            },
            to: {
                path: '^src/(game|components|views|resources)/'
            }
        },
        {
            name: 'no-deprecated-core',
            severity: 'warn',
            comment: 'Avoid deprecated core modules',
            from: {},
            to: {
                dependencyTypes: ['core'],
                path: [
                    '^punycode$',
                    '^domain$',
                    '^constants$',
                    '^sys$',
                    '^_linklist$',
                    '^_stream_wrap$'
                ]
            }
        }
    ],
    options: {
        doNotFollow: {
            path: 'node_modules'
        },
        tsPreCompilationDeps: true,
        tsConfig: {
            fileName: 'tsconfig.json'
        },
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default']
        },
        reporterOptions: {
            dot: {
                collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)'
            },
            text: {
                highlightFocused: true
            }
        }
    }
};

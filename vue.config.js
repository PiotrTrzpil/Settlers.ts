module.exports = {
    // vue-router v4.6 ships .mjs with optional chaining that needs transpiling
    transpileDependencies: ['vue-router'],
    chainWebpack: config => {
        config.module
            .rule('glsl')
            .test(/\.(glsl|vs|fs)$/)
            .use('ts-shader-loader')
            .loader('ts-shader-loader')
            .end();

        // Exclude HD asset folders from copy — they're large, not used by the
        // web app, and contain casing conflicts that break on macOS/Windows.
        config.plugin('copy').tap(args => {
            const pattern = args[0].patterns[0];
            pattern.globOptions = {
                ...pattern.globOptions,
                ignore: [
                    ...(pattern.globOptions?.ignore || []),
                    '**/Siedler4/paks/**',
                    '**/Siedler4/paks-lite/**',
                    '**/Siedler4/movies/**',
                    '**/Siedler4/cursor/**',
                    '**/Siedler4/fonts/**',
                    '**/Siedler4/lib/**',
                    '**/Siedler4/menu/**',
                    '**/Siedler4/settings/**',
                    '**/Siedler4/shader/**',
                    '**/Siedler4/Snd/**',
                ]
            };
            return args;
        });
    }
};

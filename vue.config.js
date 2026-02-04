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
    }
};

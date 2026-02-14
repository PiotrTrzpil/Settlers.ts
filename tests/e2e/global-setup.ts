/**
 * Playwright global setup - runs once before all tests.
 * Detects browser capabilities and adjusts environment accordingly.
 */
import { chromium } from '@playwright/test';

interface BrowserCapabilities {
    webgl2: boolean;
    renderer: string;
    vendor: string;
    isSwiftShader: boolean;
    isSoftwareRenderer: boolean;
    maxTextureSize: number;
}

async function detectBrowserCapabilities(launchArgs: string[]): Promise<BrowserCapabilities | null> {
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: launchArgs,
        });
        const context = await browser.newContext();
        const page = await context.newPage();

        const capabilities = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
            if (!gl) {
                return {
                    webgl2: false,
                    renderer: 'none',
                    vendor: 'none',
                    isSwiftShader: false,
                    isSoftwareRenderer: true,
                    maxTextureSize: 0,
                };
            }

            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            const renderer = debugInfo
                ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
                : gl.getParameter(gl.RENDERER);
            const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);

            const isSwiftShader = renderer.includes('SwiftShader') || renderer.includes('llvmpipe');
            const isSoftwareRenderer = isSwiftShader || renderer.includes('Software') || renderer.includes('Mesa');

            return {
                webgl2: true,
                renderer,
                vendor,
                isSwiftShader,
                isSoftwareRenderer,
                maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            };
        });

        await browser.close();
        return capabilities;
    } catch {
        if (browser) await browser.close();
        return null;
    }
}

export default async function globalSetup() {
    const isCloudEnv = process.env.CI || process.env.CLAUDE_CODE_REMOTE === 'true';

    // Build launch args matching playwright.config.ts
    const launchArgs = ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'];
    if (isCloudEnv) {
        launchArgs.push('--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-webgl');
    } else {
        // Local macOS: use Metal for GPU acceleration
        launchArgs.push('--use-angle=metal', '--enable-webgl');
    }

    console.log('\n🔍 Detecting browser capabilities...');

    const capabilities = await detectBrowserCapabilities(launchArgs);

    if (!capabilities) {
        console.log('⚠️  Could not detect browser capabilities (browser launch failed)');
        console.log('   Tests requiring WebGL may fail.\n');
        process.env.E2E_WEBGL_AVAILABLE = 'false';
        return;
    }

    // Log detected capabilities
    console.log(`   WebGL2: ${capabilities.webgl2 ? '✓' : '✗'}`);
    console.log(`   Renderer: ${capabilities.renderer}`);
    console.log(`   Vendor: ${capabilities.vendor}`);
    if (capabilities.webgl2) {
        console.log(`   Max texture size: ${capabilities.maxTextureSize}`);
    }
    if (capabilities.isSoftwareRenderer) {
        console.log(`   ⚠️  Software renderer detected (may be slower)`);
    }

    // Set environment variables for tests to use
    process.env.E2E_WEBGL_AVAILABLE = capabilities.webgl2 ? 'true' : 'false';
    process.env.E2E_SOFTWARE_RENDERER = capabilities.isSoftwareRenderer ? 'true' : 'false';
    process.env.E2E_RENDERER = capabilities.renderer;

    // If WebGL2 is not available and we're in cloud, try enabling SwiftShader
    if (!capabilities.webgl2 && !isCloudEnv) {
        console.log('\n   Retrying with SwiftShader...');
        const swiftShaderArgs = [...launchArgs, '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-webgl'];
        const retryCapabilities = await detectBrowserCapabilities(swiftShaderArgs);

        if (retryCapabilities?.webgl2) {
            console.log('   ✓ SwiftShader enables WebGL2');
            console.log('   Consider setting CI=true or CLAUDE_CODE_REMOTE=true to auto-enable');
            // Update env to signal that SwiftShader works
            process.env.E2E_SWIFTSHADER_AVAILABLE = 'true';
        } else {
            console.log('   ✗ SwiftShader did not enable WebGL2');
        }
    }

    if (!capabilities.webgl2) {
        console.log('\n⚠️  WebGL2 not available - some tests will be skipped');
        console.log('   Run: npx playwright test game-logic --reporter=list');
        console.log('   for tests that work without WebGL.\n');
    } else {
        console.log('');
    }
}

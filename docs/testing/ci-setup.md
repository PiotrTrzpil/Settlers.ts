# E2E Test Environment Troubleshooting

Guide for running Playwright e2e tests in containerized, CI, or headless environments
where Chromium may not have full system access.

---

## Issue 1: Chromium Crashes with "Target crashed"

### Symptoms

```
browserType.launch: Target crashed
=========================== logs ===========================
<launching chromium>
```

Chromium exits immediately after launch. No browser window or page loads.

### Root Cause

Chromium uses `/dev/shm` (shared memory) for IPC between its processes. In many
containerized environments (Docker, CI runners, sandboxed VMs), `/tmp` or `/dev/shm`
has restricted write permissions or limited size.

When Chromium cannot create shared memory files, it crashes on startup.

You can verify this is the issue by checking:

```sh
# Check if /tmp is writable
touch /tmp/test-write && echo "OK" || echo "FAILED"

# Check /dev/shm size (Chromium needs at least ~64MB)
df -h /dev/shm
```

### Solution

Set `TMPDIR` to a writable directory before running tests:

```sh
export TMPDIR=/path/to/writable/dir
mkdir -p "$TMPDIR"
npx playwright test
```

In a project directory:

```sh
mkdir -p .tmp
TMPDIR=$(pwd)/.tmp npx playwright test
```

**Alternative solutions:**

1. **Docker `--shm-size`**: If running in Docker, increase shared memory:
   ```sh
   docker run --shm-size=256m ...
   ```

2. **Docker `--ipc=host`**: Share the host's IPC namespace:
   ```sh
   docker run --ipc=host ...
   ```

3. **Playwright config**: Disable shared memory usage in `playwright.config.ts`:
   ```typescript
   use: {
       launchOptions: {
           args: ['--disable-dev-shm-usage'],
       },
   },
   ```
   Note: This makes Chromium use `/tmp` instead of `/dev/shm`, which is slower
   but works in more environments.

### Cleanup

If you use a local `.tmp` directory, add it to `.gitignore` and clean up after tests:

```sh
rm -rf .tmp
```

---

## Issue 2: WebGL2 Renderer Fails in Headless Environment

### Symptoms

The shared `testMapPage` fixture times out during setup:

```
fixture "testMapPage" timed out (45000ms)
```

The `waitForReady()` call never resolves because `rendererReady` stays `false`
and `gameLoaded` stays `false`.

Tests that depend on the shared fixture (most spec files) fail with:

```
Test timeout of 10000ms exceeded while setting up "gp"
```

Meanwhile, tests that **don't** use the shared fixture (e.g., `game-logic.spec.ts`
tests for app loading and navigation) pass fine.

### Root Cause

The game uses a WebGL2 renderer (`canvas.getContext('webgl2')`). In headless
environments without GPU support:

- Chromium's software WebGL implementation may not support WebGL2
- Or the WebGL2 context creation succeeds but shader compilation fails
- Or the renderer initializes but cannot render frames (frameCount stays at 0)

The shared fixture (`tests/e2e/fixtures.ts`) waits for both `gameLoaded` and
`rendererReady` to become `true`. If the WebGL2 renderer cannot initialize,
`rendererReady` never becomes `true`, and the fixture times out.

### Diagnosis

Check what Chromium reports for WebGL support:

```typescript
// In a Playwright test or script
const glInfo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return { supported: false };
    return {
        supported: true,
        renderer: gl.getParameter(gl.RENDERER),
        vendor: gl.getParameter(gl.VENDOR),
        version: gl.getParameter(gl.VERSION),
    };
});
console.log(glInfo);
```

Common outputs in headless environments:

- `{ supported: false }` — WebGL2 not available at all
- `renderer: "Google SwiftShader"` — software fallback, may work but slowly
- `renderer: "ANGLE (...)"`— hardware-accelerated, should work

### Solution

**Option A: Enable GPU in CI (preferred)**

If your CI supports GPU (e.g., GPU-enabled runners, cloud instances with GPUs):

```yaml
# GitHub Actions example with GPU
- uses: browser-actions/setup-chrome@latest
  with:
    chrome-version: stable
```

**Option B: Use SwiftShader (software rendering)**

Chromium ships with SwiftShader for software WebGL. Enable it explicitly:

```sh
npx playwright test -- --args='--use-gl=swiftshader'
```

Or in `playwright.config.ts`:

```typescript
use: {
    launchOptions: {
        args: [
            '--use-gl=swiftshader',
            '--enable-webgl',
            '--enable-webgl2-compute-context',
        ],
    },
},
```

**Option C: Run only non-WebGL tests**

If GPU support is not available and SwiftShader doesn't work, you can still run
tests that don't depend on the shared fixture:

```sh
# game-logic.spec.ts tests pass without WebGL
npx playwright test game-logic
```

These tests verify app loading, navigation, route handling, and basic page structure
without requiring the renderer to initialize.

**Option D: Skip WebGL-dependent tests in CI**

Tag WebGL-dependent tests and skip them:

```sh
npx playwright test --grep-invert @requires-webgl
```

### Which Tests Need WebGL?

| Test file | Needs WebGL? | Reason |
|-----------|-------------|--------|
| `game-logic.spec.ts` (some tests) | No | Tests app loading, navigation, basic DOM |
| `building-placement.spec.ts` | Yes | Uses shared fixture, places entities |
| `resource-placement.spec.ts` | Yes | Uses shared fixture, places entities |
| `unit-movement.spec.ts` | Yes | Uses shared fixture, moves units |
| `unit-movement-animations.spec.ts` | Yes | Uses shared fixture, checks animations |
| `carrier-logistics.spec.ts` | Yes | Uses shared fixture, tests logistics |
| `unit-sprites.spec.ts` | Yes | Requires renderer + real game assets |
| `terrain-rendering.spec.ts` | Yes | Screenshot regression, needs rendering |

---

## Issue 3: `pnpm install` Requires Interactive Approval

### Symptoms

```sh
$ pnpm install
 WARN  2 deprecated subdependencies found
? Do you want to approve these builds? (y/N)
```

The `pnpm install` command hangs waiting for interactive input, which is not
available in CI or automated environments.

### Solution

Use `--ignore-scripts` to bypass the interactive approval:

```sh
pnpm install --ignore-scripts
```

Or pre-approve builds in the pnpm config:

```sh
pnpm config set approve-builds true
```

For CI pipelines, you can also use:

```sh
echo "y" | pnpm install
# Or
CI=true pnpm install
```

---

## Issue 4: Playwright Browsers Not Installed

### Symptoms

```
Executable doesn't exist at /home/user/.cache/ms-playwright/chromium-xxxx/chrome-linux/chrome
```

### Solution

Install Playwright browsers (usually done once during project setup):

```sh
npx playwright install chromium
```

For CI, install system dependencies too:

```sh
npx playwright install --with-deps chromium
```

---

## Recommended CI Configuration

Here's a complete CI setup that handles all the issues above:

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --ignore-scripts

      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: Build
        run: pnpm build

      - name: Run E2E tests
        run: npx playwright test --reporter=list
        env:
          TMPDIR: ${{ runner.temp }}
          # If GPU not available, only run non-WebGL tests:
          # npx playwright test game-logic
```

### Docker Compose Example

```yaml
services:
  e2e:
    build: .
    shm_size: '256m'    # Enough shared memory for Chromium
    environment:
      - CI=true
      - TMPDIR=/tmp/playwright
    command: |
      sh -c "
        mkdir -p /tmp/playwright &&
        pnpm install --ignore-scripts &&
        npx playwright install --with-deps chromium &&
        pnpm build &&
        npx playwright test --reporter=list
      "
```

---

## Quick Reference

| Problem | Quick Fix |
|---------|-----------|
| Chromium crashes on launch | `export TMPDIR=/writable/path` or `--disable-dev-shm-usage` |
| Shared fixture times out | No GPU available; use `--use-gl=swiftshader` or skip WebGL tests |
| `pnpm install` hangs | `pnpm install --ignore-scripts` |
| Browsers not installed | `npx playwright install --with-deps chromium` |
| Tests pass locally but fail in CI | Check all of the above in order |

---

## Environment Verification Script

Run this script to check if your environment is ready for e2e tests:

```sh
#!/bin/bash
echo "=== E2E Environment Check ==="

# Check /tmp writability
echo -n "/tmp writable: "
touch /tmp/.e2e-check 2>/dev/null && echo "YES" && rm /tmp/.e2e-check || echo "NO - set TMPDIR"

# Check /dev/shm size
echo -n "/dev/shm size: "
df -h /dev/shm 2>/dev/null | tail -1 | awk '{print $2}' || echo "N/A"

# Check Chromium
echo -n "Chromium installed: "
npx playwright install --dry-run chromium 2>/dev/null && echo "YES" || echo "NO - run: npx playwright install chromium"

# Check build
echo -n "Build exists: "
[ -d "dist" ] && echo "YES" || echo "NO - run: pnpm build"

# Check WebGL (requires running browser)
echo ""
echo "To check WebGL support, run:"
echo "  npx playwright test game-logic --reporter=list"
echo "If those pass, basic browser support is working."
echo "If shared-fixture tests fail, WebGL2 is likely unsupported."
```

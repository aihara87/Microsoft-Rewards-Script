# Termux Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git safety:** Do not create git commits unless the user explicitly requests commits. The checkpoint steps below replace commit steps for this repository session.

**Goal:** Enable Microsoft-Rewards-Script to run directly in Termux by launching Termux-installed Chromium through a configurable executable path while preserving existing Patchright behavior elsewhere.

**Architecture:** Keep Patchright as the browser runtime and add a small launch-options helper for the main TypeScript bot. Mirror the same executable-path and browser-args logic in the JavaScript `open-session` utilities so both runtime entry points support Termux Chromium.

**Tech Stack:** Node.js >= 24, TypeScript 6, Patchright 1.60, Zod 4, Termux `x11-repo` and `chromium` package.

---

## File Structure

- Create: `src/browser/BrowserLaunchOptions.ts`
    - Resolves `config.browserExecutablePath`, `CHROMIUM_PATH`, and `BROWSER_EXECUTABLE_PATH`.
    - Adds Termux-only `--disable-gpu` when Termux is detected.
    - Validates configured executable paths before Patchright launch.
    - Formats extra launch error context for external Chromium failures.
- Modify: `src/interface/Config.ts`
    - Adds optional `browserExecutablePath` and `browserArgs` fields.
- Modify: `src/util/Validator.ts`
    - Allows the new optional config fields through Zod validation.
- Modify: `src/config.example.json`
    - Documents the new fields with safe empty defaults.
- Modify: `src/browser/Browser.ts`
    - Uses `BrowserLaunchOptions.ts` to pass `executablePath` and merged args to `rebrowser.chromium.launch`.
- Modify: `scripts/utils.js`
    - Adds JavaScript equivalents for executable-path resolution, Termux arg merging, validation, and error context.
- Modify: `scripts/main/browserSession.js`
    - Uses the JavaScript helper functions when launching the manual browser session.
- Modify: `package.json`
    - Adds Termux setup scripts that do not call `npx patchright install chromium`.
- Modify: `README.md`
    - Adds Termux setup documentation and config table rows.

---

### Task 1: Add Config Surface

**Files:**

- Modify: `src/interface/Config.ts`
- Modify: `src/util/Validator.ts`
- Modify: `src/config.example.json`

- [ ] **Step 1: Update the `Config` interface**

In `src/interface/Config.ts`, add the optional fields immediately after `headless`:

```ts
export interface Config {
    baseURL: string
    sessionPath: string
    headless: boolean
    browserExecutablePath?: string
    browserArgs?: string[]
    clusters: number
    errorDiagnostics: boolean
    ensureStreakProtection: boolean
    workers: ConfigWorkers
    searchOnBingLocalQueries: boolean
    globalTimeout: number | string
    searchSettings: ConfigSearchSettings
    debugLogs: boolean
    proxy: ConfigProxy
    consoleLogFilter: LogFilter
    webhook: ConfigWebhook
}
```

- [ ] **Step 2: Update the Zod config schema**

In `src/util/Validator.ts`, update the top-level `ConfigSchema` section so the start of the object is:

```ts
export const ConfigSchema = z.object({
    baseURL: z.string(),
    sessionPath: z.string(),
    headless: z.boolean(),
    browserExecutablePath: z.string().optional(),
    browserArgs: z.array(z.string()).optional(),
    clusters: z.number().int().nonnegative(),
    errorDiagnostics: z.boolean(),
    ensureStreakProtection: z.boolean(),
```

Leave `defaultConfig` without `browserExecutablePath`; old configs must remain valid. Do not force `browserArgs` into old configs. Missing optional fields are valid because the schema marks them optional.

- [ ] **Step 3: Update the example config**

In `src/config.example.json`, add the new fields immediately after `headless`:

```json
{
    "baseURL": "https://rewards.bing.com",
    "sessionPath": "sessions",
    "headless": false,
    "browserExecutablePath": "",
    "browserArgs": [],
    "clusters": 1,
```

An empty `browserExecutablePath` is intentional. The resolver in Task 2 trims it and falls back to environment variables or managed Patchright Chromium.

- [ ] **Step 4: Verify config typing**

Run:

```bash
npm run build
```

Expected: `tsc` completes with exit code 0. If it fails because local `src/config.json` or `src/accounts.json` is missing, create those from the existing example files and re-run:

```bash
cp src/config.example.json src/config.json
cp src/accounts.example.json src/accounts.json
npm run build
```

Checkpoint: `Config` accepts existing config files and the new optional fields.

---

### Task 2: Add TypeScript Browser Launch Helper

**Files:**

- Create: `src/browser/BrowserLaunchOptions.ts`

- [ ] **Step 1: Create the helper file**

Create `src/browser/BrowserLaunchOptions.ts` with this complete content:

```ts
import fs from 'fs'

import type { Config } from '../interface/Config'

const TERMUX_PATH_PREFIX = '/data/data/com.termux/'
const TERMUX_BROWSER_ARGS = ['--disable-gpu'] as const
const EXECUTABLE_PATH_ENV_VARS = ['CHROMIUM_PATH', 'BROWSER_EXECUTABLE_PATH'] as const

export function resolveBrowserExecutablePath(config: Pick<Config, 'browserExecutablePath'>): string | undefined {
    const configuredPath = config.browserExecutablePath?.trim()
    if (configuredPath) {
        return configuredPath
    }

    for (const envVar of EXECUTABLE_PATH_ENV_VARS) {
        const envPath = process.env[envVar]?.trim()
        if (envPath) {
            return envPath
        }
    }

    return undefined
}

export function isTermuxBrowserEnvironment(executablePath?: string): boolean {
    return Boolean(process.env.TERMUX_VERSION) || Boolean(executablePath?.startsWith(TERMUX_PATH_PREFIX))
}

export function createBrowserArgs(
    baseArgs: readonly string[],
    config: Pick<Config, 'browserArgs'>,
    executablePath?: string
): string[] {
    const args = [...baseArgs]

    if (isTermuxBrowserEnvironment(executablePath)) {
        args.push(...TERMUX_BROWSER_ARGS)
    }

    for (const arg of config.browserArgs ?? []) {
        const normalizedArg = arg.trim()
        if (normalizedArg) {
            args.push(normalizedArg)
        }
    }

    return [...new Set(args)]
}

export function validateBrowserExecutablePath(executablePath: string | undefined): void {
    if (!executablePath || fs.existsSync(executablePath)) {
        return
    }

    throw new Error(
        [
            `Browser executable path not found: ${executablePath}.`,
            'On Termux, install Chromium with "pkg install x11-repo chromium".',
            'Verify the browser path with "which chromium-browser".',
            'Set CHROMIUM_PATH or config.browserExecutablePath to the verified path.'
        ].join(' ')
    )
}

export function getExternalBrowserErrorContext(executablePath: string | undefined): string {
    if (!executablePath) {
        return ''
    }

    return [
        ` External Chromium executable: ${executablePath}.`,
        'On Termux this uses the Chromium package installed by pkg;',
        'Patchright can still fail if the external browser version is incompatible.'
    ].join(' ')
}
```

- [ ] **Step 2: Verify helper compiles**

Run:

```bash
npm run build
```

Expected: `tsc` completes with exit code 0. The new helper is not imported yet, so this check proves the helper itself has valid TypeScript syntax and no unused declarations.

Checkpoint: TypeScript has a reusable browser launch helper for Termux path resolution and args.

---

### Task 3: Use Launch Helper in Main Browser Runtime

**Files:**

- Modify: `src/browser/Browser.ts`

- [ ] **Step 1: Add helper imports**

In `src/browser/Browser.ts`, add this import below the existing local imports:

```ts
import {
    createBrowserArgs,
    getExternalBrowserErrorContext,
    resolveBrowserExecutablePath,
    validateBrowserExecutablePath
} from './BrowserLaunchOptions'
```

The top of the file should include:

```ts
import rebrowser, { BrowserContext } from 'patchright'
import { newInjectedContext } from 'fingerprint-injector'
import { BrowserFingerprintWithHeaders, FingerprintGenerator } from 'fingerprint-generator'

import type { MicrosoftRewardsBot } from '../index'
import { loadSessionData, saveFingerprintData } from '../util/Load'
import { UserAgentManager } from './UserAgent'
import {
    createBrowserArgs,
    getExternalBrowserErrorContext,
    resolveBrowserExecutablePath,
    validateBrowserExecutablePath
} from './BrowserLaunchOptions'

import type { Account, AccountProxy } from '../interface/Account'
```

- [ ] **Step 2: Replace the browser launch block**

In `createBrowser`, replace the current first `try` block from `let browser: rebrowser.Browser` through its `catch` with this code:

```ts
let browser: rebrowser.Browser
const browserExecutablePath = resolveBrowserExecutablePath(this.bot.config)

try {
    validateBrowserExecutablePath(browserExecutablePath)

    const proxyConfig = account.proxy.url
        ? {
              server: this.formatProxyServer(account.proxy),
              ...(account.proxy.username &&
                  account.proxy.password && {
                      username: account.proxy.username,
                      password: account.proxy.password
                  })
          }
        : undefined

    const browserArgs = createBrowserArgs(Browser.BROWSER_ARGS, this.bot.config, browserExecutablePath)

    browser = await rebrowser.chromium.launch({
        headless: this.bot.config.headless,
        ...(browserExecutablePath && { executablePath: browserExecutablePath }),
        ...(proxyConfig && { proxy: proxyConfig }),
        args: browserArgs
    })
} catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    this.bot.logger.error(
        this.bot.isMobile,
        'BROWSER',
        `Launch failed: ${errorMessage}${getExternalBrowserErrorContext(browserExecutablePath)}`
    )
    throw error
}
```

- [ ] **Step 3: Verify main runtime compiles**

Run:

```bash
npm run build
```

Expected: `tsc` completes with exit code 0. The generated `dist/browser/Browser.js` should contain `executablePath` only in the conditional object spread.

Checkpoint: main bot launch honors config/env executable paths without changing default Patchright launch behavior.

---

### Task 4: Add JavaScript Launch Helpers for Manual Session Opener

**Files:**

- Modify: `scripts/utils.js`
- Modify: `scripts/main/browserSession.js`

- [ ] **Step 1: Add helper functions to `scripts/utils.js`**

In `scripts/utils.js`, insert these constants and functions immediately after `export function log(level, ...args) { ... }`:

```js
const TERMUX_PATH_PREFIX = '/data/data/com.termux/'
const TERMUX_BROWSER_ARGS = ['--disable-gpu']
const EXECUTABLE_PATH_ENV_VARS = ['CHROMIUM_PATH', 'BROWSER_EXECUTABLE_PATH']

export function resolveBrowserExecutablePath(config = {}) {
    const configuredPath = typeof config.browserExecutablePath === 'string' ? config.browserExecutablePath.trim() : ''
    if (configuredPath) {
        return configuredPath
    }

    for (const envVar of EXECUTABLE_PATH_ENV_VARS) {
        const envPath = process.env[envVar]?.trim()
        if (envPath) {
            return envPath
        }
    }

    return undefined
}

export function isTermuxBrowserEnvironment(executablePath) {
    return Boolean(process.env.TERMUX_VERSION) || Boolean(executablePath?.startsWith(TERMUX_PATH_PREFIX))
}

export function mergeBrowserArgs(baseArgs, config = {}, executablePath) {
    const args = [...baseArgs]

    if (isTermuxBrowserEnvironment(executablePath)) {
        args.push(...TERMUX_BROWSER_ARGS)
    }

    if (Array.isArray(config.browserArgs)) {
        for (const arg of config.browserArgs) {
            if (typeof arg !== 'string') continue

            const normalizedArg = arg.trim()
            if (normalizedArg) {
                args.push(normalizedArg)
            }
        }
    }

    return [...new Set(args)]
}

export function validateBrowserExecutablePath(executablePath) {
    if (!executablePath || fs.existsSync(executablePath)) {
        return
    }

    log('ERROR', `Browser executable path not found: ${executablePath}`)
    log('ERROR', 'On Termux, install Chromium with: pkg install x11-repo chromium')
    log('ERROR', 'Verify the browser path with: which chromium-browser')
    log('ERROR', 'Set CHROMIUM_PATH or config.browserExecutablePath to the verified path')
    process.exit(1)
}

export function getExternalBrowserErrorContext(executablePath) {
    if (!executablePath) {
        return ''
    }

    return ` External Chromium executable: ${executablePath}. On Termux this uses the Chromium package installed by pkg; Patchright can still fail if the external browser version is incompatible.`
}
```

- [ ] **Step 2: Import the helper functions in `browserSession.js`**

In `scripts/main/browserSession.js`, update the import from `../utils.js` to include:

```js
    resolveBrowserExecutablePath,
    mergeBrowserArgs,
    validateBrowserExecutablePath,
    getExternalBrowserErrorContext,
```

The import block should become:

```js
import {
    getDirname,
    getProjectRoot,
    log,
    parseArgs,
    validateEmail,
    loadConfig,
    loadAccounts,
    findAccountByEmail,
    getRuntimeBase,
    getSessionPath,
    loadCookies,
    loadFingerprint,
    buildProxyConfig,
    resolveBrowserExecutablePath,
    mergeBrowserArgs,
    validateBrowserExecutablePath,
    getExternalBrowserErrorContext,
    setupCleanupHandlers
} from '../utils.js'
```

- [ ] **Step 3: Move manual-session browser args into a constant**

In `scripts/main/browserSession.js`, add this constant after `const projectRoot = getProjectRoot(__dirname)`:

```js
const BROWSER_ARGS = [
    '--no-sandbox',
    '--mute-audio',
    '--disable-setuid-sandbox',
    '--ignore-certificate-errors',
    '--ignore-certificate-errors-spki-list',
    '--ignore-ssl-errors',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-user-media-security=true',
    '--disable-blink-features=Attestation',
    '--disable-features=WebAuthentication,PasswordManagerOnboarding,PasswordManager,EnablePasswordsAccountStorage,Passkeys',
    '--disable-save-password-bubble'
]
```

- [ ] **Step 4: Replace the manual launch block**

In `scripts/main/browserSession.js`, replace the current `const browser = await chromium.launch({ ... })` block with this code:

```js
const browserExecutablePath = resolveBrowserExecutablePath(config)
validateBrowserExecutablePath(browserExecutablePath)
const browserArgs = mergeBrowserArgs(BROWSER_ARGS, config, browserExecutablePath)

let browser
try {
    browser = await chromium.launch({
        headless: false,
        ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
        ...(proxy ? { proxy } : {}),
        args: browserArgs
    })
} catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log('ERROR', `Browser launch failed: ${errorMessage}${getExternalBrowserErrorContext(browserExecutablePath)}`)
    process.exit(1)
}
```

- [ ] **Step 5: Verify JavaScript syntax and TypeScript build**

Run:

```bash
node --check scripts/utils.js
node --check scripts/main/browserSession.js
npm run build
```

Expected: both `node --check` commands produce no syntax errors, and `tsc` completes with exit code 0.

Checkpoint: `npm run open-session` now resolves the same external Chromium path as the main bot.

---

### Task 5: Add Termux Package Scripts

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Add Termux scripts**

In `package.json`, add `pre-build:termux` and `setup:termux` immediately after `pre-build`:

```json
    "scripts": {
        "pre-build": "npm i && rimraf dist && npx patchright install chromium",
        "pre-build:termux": "npm i && rimraf dist",
        "setup:termux": "npm run pre-build:termux && npm run build",
        "build": "rimraf dist && tsc",
```

Do not remove `pre-build`; desktop users still use Patchright's managed Chromium install.

- [ ] **Step 2: Validate package JSON and build script**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8')); console.log('package.json ok')"
npm run build
```

Expected output includes:

```text
package.json ok
```

Expected: `npm run build` completes with exit code 0.

Checkpoint: Termux users have a documented script path that avoids managed browser installation.

---

### Task 6: Document Termux Setup

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add Termux to the table of contents**

In `README.md`, update the table of contents to include Termux under Quick Setup:

```md
- [Quick Setup](#quick-setup)
    - [Bare metal](#bare-metal)
    - [Termux](#termux)
    - [Docker](#docker)
- [Nix Setup](#nix-setup)
- [Configuration Options](#configuration-options)
- [Account Setup](#account-setup)
- [Troubleshooting](#troubleshooting)
- [Disclaimer](#disclaimer)
```

- [ ] **Step 2: Add the Termux setup section**

Insert this section after the bare metal build/run block and before `### Docker`:

````md
### Termux

**Requirements:** Termux, Node.js >= 24, Git, and Chromium from the Termux X11 repository.

Termux uses the Chromium package installed by `pkg`. Do not run `npm run pre-build` on Termux because that command runs `npx patchright install chromium` for desktop-style managed browser installs.

#### Install Termux packages

```bash
pkg update
pkg install nodejs git x11-repo chromium
```
````

#### Get the script

```bash
git clone https://github.com/TheNetsky/Microsoft-Rewards-Script.git
cd Microsoft-Rewards-Script
```

#### Create account and config files

```bash
cp src/accounts.example.json src/accounts.json
cp src/config.example.json src/config.json
```

Edit `src/accounts.json` and `src/config.json` before building.

For headless Termux runs, set `headless` to `true` in `src/config.json`.

#### Point the script at Termux Chromium

Use an environment variable:

```bash
export CHROMIUM_PATH="$(which chromium-browser)"
```

Or set the path in `src/config.json`:

```json
"browserExecutablePath": "/data/data/com.termux/files/usr/bin/chromium-browser",
"browserArgs": ["--disable-gpu"]
```

#### Build and run on Termux

```bash
npm install
npm run build
npm run start
```

You can also use:

```bash
npm run setup:termux
npm run start
```

#### Manual session opener on Termux

`npm run open-session` opens a visible browser with `headless: false`. On Termux this may require Termux:X11, VNC, or another display environment:

```bash
CHROMIUM_PATH="$(which chromium-browser)" npm run open-session -- -email you@example.com
```

````

- [ ] **Step 3: Add config table rows**

In the Core configuration table, add these rows immediately after `headless`:

```md
| `browserExecutablePath` | string   | `""`                        | Path to an existing Chromium executable, useful for Termux |                                   |
| `browserArgs`           | string[] | `[]`                          | Extra Chromium launch args appended to defaults            |                                   |
````

- [ ] **Step 4: Verify markdown and build still pass**

Run:

```bash
npm run build
```

Expected: `tsc` completes with exit code 0. README changes do not affect compile output.

Checkpoint: README tells Termux users which install path to use and which desktop install command to avoid.

---

### Task 7: Final Verification

**Files:**

- Verify all changed files from Tasks 1-6.

- [ ] **Step 1: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: build completes with exit code 0.

- [ ] **Step 2: Run JavaScript syntax checks**

Run:

```bash
node --check scripts/utils.js
node --check scripts/main/browserSession.js
```

Expected: both commands complete with exit code 0 and print no syntax errors.

- [ ] **Step 3: Confirm Termux path resolution manually without launching a browser**

Run:

```bash
CHROMIUM_PATH=/data/data/com.termux/files/usr/bin/chromium-browser node --input-type=module -e "import { resolveBrowserExecutablePath, mergeBrowserArgs } from './scripts/utils.js'; const path = resolveBrowserExecutablePath({}); const args = mergeBrowserArgs(['--no-sandbox'], {}, path); console.log(path); console.log(args.includes('--disable-gpu'))"
```

Expected output:

```text
/data/data/com.termux/files/usr/bin/chromium-browser
true
```

- [ ] **Step 4: Confirm default behavior leaves executable path unset**

Run:

```bash
env -u CHROMIUM_PATH -u BROWSER_EXECUTABLE_PATH node --input-type=module -e "import { resolveBrowserExecutablePath, mergeBrowserArgs } from './scripts/utils.js'; const path = resolveBrowserExecutablePath({ browserExecutablePath: '' }); const args = mergeBrowserArgs(['--no-sandbox'], { browserArgs: [] }, path); console.log(String(path)); console.log(args.join(','))"
```

Expected output:

```text
undefined
--no-sandbox
```

- [ ] **Step 5: Review git diff without committing**

Run:

```bash
git diff -- src/interface/Config.ts src/util/Validator.ts src/config.example.json src/browser/BrowserLaunchOptions.ts src/browser/Browser.ts scripts/utils.js scripts/main/browserSession.js package.json README.md
```

Expected: diff only contains Termux browser-executable support, Termux scripts, and Termux documentation. Do not commit unless the user explicitly requests a commit.

Checkpoint: the implementation is ready for on-device Termux testing.

---

## Manual Termux Acceptance Test

Run on an Android device inside Termux:

```bash
pkg update
pkg install nodejs git x11-repo chromium
git clone https://github.com/TheNetsky/Microsoft-Rewards-Script.git
cd Microsoft-Rewards-Script
cp src/accounts.example.json src/accounts.json
cp src/config.example.json src/config.json
```

Edit `src/accounts.json` with a valid account, set `headless` to `true` in `src/config.json`, then run:

```bash
export CHROMIUM_PATH="$(which chromium-browser)"
npm install
npm run build
npm run start
```

Expected result: the bot starts, Patchright launches Termux Chromium through `CHROMIUM_PATH`, and launch failures include the external Chromium path in the error message.

---

## Self-Review

- Spec coverage: Tasks 1-4 implement config/env path resolution, Termux args, main bot launch, manual session launch, and actionable invalid-path errors. Tasks 5-6 implement Termux setup scripts and README documentation. Task 7 covers compile, syntax, and path-resolution verification.
- Type consistency: The TypeScript helper uses `browserExecutablePath?: string` and `browserArgs?: string[]`, matching `Config.ts` and `Validator.ts`. The JavaScript helper uses the same field names and the same env precedence.
- Scope: The plan keeps Patchright as the runtime and does not introduce `playwright-core`, remote browser control, Docker changes, or session-path redesign.
- Git safety: The plan includes no commit commands because this session has no explicit user request to commit.

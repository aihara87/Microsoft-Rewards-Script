# Termux Support Design

## Goal

Make Microsoft-Rewards-Script runnable directly in Termux on Android by launching the Chromium package installed by Termux instead of relying on Patchright's managed browser download. Existing desktop, Docker, and Nix workflows must continue to behave as they do today.

The primary target workflow is:

```sh
pkg install x11-repo chromium
export CHROMIUM_PATH="$(which chromium-browser)"
npm install
npm run build
npm run start
```

## Non-goals

- Do not replace Patchright globally in the first implementation.
- Do not add Firefox or WebKit support.
- Do not require Docker, proot, VNC, or a remote browser for the normal Termux path.
- Do not redesign account, session, reward, or search logic.
- Do not change Docker/Nix browser installation behavior except where documentation must clarify that Termux uses a different path.

## Current constraints

- Runtime browser creation is centralized mostly in `src/browser/Browser.ts`, which launches `rebrowser.chromium` from `patchright`.
- Manual session opening is handled separately in `scripts/main/browserSession.js`, which launches `chromium` from `patchright` with `headless: false`.
- `package.json` currently has `pre-build` set to `npm i && rimraf dist && npx patchright install chromium`; this is not appropriate for Termux because Termux should use the `chromium` package from `pkg`.
- The referenced `Jobians/playwright-termux` repository proves a `playwright-core` plus `executablePath` pattern, not Patchright itself. The design therefore keeps Patchright as the default but makes the browser executable configurable so it can use Termux Chromium.
- Config currently exposes `headless` and `sessionPath`, but no browser executable path or custom launch args.

## Chosen approach

Use a minimal external-browser launch path while keeping Patchright as the browser runtime.

Add configuration and environment-variable support for an explicit Chromium executable path. When this path is present, pass it to `chromium.launch({ executablePath })`. When absent, preserve the existing Patchright-managed browser behavior.

Executable path resolution order:

1. `config.browserExecutablePath`
2. `process.env.CHROMIUM_PATH`
3. `process.env.BROWSER_EXECUTABLE_PATH`
4. no explicit executable path, preserving current behavior

This keeps existing users unaffected while enabling Termux users to point the script at `/data/data/com.termux/files/usr/bin/chromium-browser`.

## Configuration changes

Add optional config fields:

```ts
browserExecutablePath?: string
browserArgs?: string[]
```

`browserExecutablePath` is the stable config-file way to set Termux Chromium. `browserArgs` lets advanced users add runtime-specific Chromium flags without modifying source code.

Example Termux config fragment:

```json
{
    "headless": true,
    "browserExecutablePath": "/data/data/com.termux/files/usr/bin/chromium-browser",
    "browserArgs": ["--disable-gpu"]
}
```

Environment-only setup remains supported:

```sh
export CHROMIUM_PATH="$(which chromium-browser)"
```

## Runtime launch behavior

`src/browser/Browser.ts` should build launch options from:

- existing `headless` config
- existing proxy config
- existing built-in browser args
- resolved executable path, if any
- optional user-provided `browserArgs`

For Termux, include `--disable-gpu` when either of these is true:

- `process.env.TERMUX_VERSION` is set
- resolved executable path starts with `/data/data/com.termux/`

The launch call remains Patchright-based:

```ts
rebrowser.chromium.launch({
    headless: this.bot.config.headless,
    executablePath,
    proxy,
    args
})
```

Fields with undefined values should be omitted so existing launch behavior remains unchanged.

## Manual session behavior

`scripts/main/browserSession.js` must use the same executable-path precedence as the main bot. It should pass `executablePath` into `chromium.launch` when configured.

The script currently forces `headless: false`, which can require Termux:X11 or another display environment. Documentation should state:

- normal bot execution should be tested first with `headless: true`
- `npm run open-session` on Termux may require Termux:X11/VNC because it opens a visible browser
- the first implementation does not guarantee headed session setup on every Android device

## Package scripts

Keep the existing `pre-build` script for desktop users who want Patchright to install its managed Chromium.

Add a Termux-specific setup/build script that avoids browser installation, for example:

```json
"pre-build:termux": "npm i && rimraf dist",
"setup:termux": "npm run pre-build:termux && npm run build"
```

Termux documentation should instruct users not to run `npm run pre-build`, because that script calls `npx patchright install chromium`.

## Documentation

Add a README Termux section covering:

1. Install Termux dependencies:
    ```sh
    pkg update
    pkg install nodejs git x11-repo chromium
    ```
2. Verify Chromium path:
    ```sh
    which chromium-browser
    ```
3. Configure project files:
    ```sh
    cp src/accounts.example.json src/accounts.json
    cp src/config.example.json src/config.json
    ```
4. Set browser executable via env or config:
    ```sh
    export CHROMIUM_PATH="$(which chromium-browser)"
    ```
5. Build and run without managed browser install:
    ```sh
    npm install
    npm run build
    npm run start
    ```

The docs should also explain that `config.json` and session files are copied/used under the existing `src` and `dist` layout, so compiled runtime behavior remains the same as other bare-metal installs.

## Error handling

If a configured executable path is present but invalid, fail early with an actionable message:

- show the invalid path
- suggest `pkg install x11-repo chromium`
- suggest `which chromium-browser`
- suggest setting `CHROMIUM_PATH` or `browserExecutablePath`

If Patchright cannot launch Termux Chromium even with a valid path, preserve the underlying browser error and add context that Termux support is using an external Chromium executable. This makes it clear whether the failure is path resolution, browser startup, or Patchright/browser-version compatibility.

## Testing plan

Automated checks:

- `npm run build` must pass.
- Config typing must accept missing optional fields and populated optional fields.
- Launch option helper behavior should be checked for:
    - no env/config path leaves `executablePath` undefined
    - `CHROMIUM_PATH` sets `executablePath`
    - `config.browserExecutablePath` overrides env values
    - Termux detection adds `--disable-gpu`

Manual Termux validation:

```sh
pkg install x11-repo chromium
export CHROMIUM_PATH="$(which chromium-browser)"
npm install
npm run build
npm run start
```

Manual session validation, if a display server is available:

```sh
CHROMIUM_PATH="$(which chromium-browser)" npm run open-session -- -email user@example.com
```

## Risks and mitigations

- Patchright may not be fully compatible with Termux Chromium. Mitigation: keep the change isolated to executable-path launch options. If testing proves Patchright incompatible, a later implementation can introduce a browser-provider abstraction and a `playwright-core` Termux runtime.
- Termux Chromium version may not match Patchright's expected Chromium revision. Mitigation: document this and expose browser args/path without changing the rest of the bot.
- Headed browser sessions may fail without Termux:X11/VNC. Mitigation: document headless bot execution as the initial supported path and mark headed session opening as display-dependent.
- Adding custom args can create unsupported combinations. Mitigation: built-in args remain the default, and user args are additive.

## Acceptance criteria

- Existing desktop behavior still works when no browser executable path is configured.
- Termux users can skip managed browser installation and run with Termux-installed Chromium by setting `CHROMIUM_PATH` or `browserExecutablePath`.
- Main bot launch and manual session launch both honor the configured executable path.
- README documents Termux installation, configuration, build, run, and headed-session caveats.
- TypeScript build passes after the changes.

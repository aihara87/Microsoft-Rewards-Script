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

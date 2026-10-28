import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { BotWriteScope } from '@candy-mountain/shared'
import { CLAUDE_BASELINE_ALLOWED_TOOLS } from './claude'
import { PostureError } from './errors'

export const CLAUDE_CHECKOUT_SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json'] as const

/** Keys no override can take back: `env` merges into every session, and each helper runs its command at launch. */
export const CLAUDE_CHECKOUT_REFUSED_SETTINGS: Readonly<Record<string, string>> = {
  env: 'its variables reach every session and no --settings key can unset them',
  apiKeyHelper: 'it runs a command at launch and replaces the session\'s login with the key it prints',
  awsAuthRefresh: 'it runs a command at launch',
  awsCredentialExport: 'it runs a command at launch',
  otelHeadersHelper: 'it runs a command at launch',
}

export interface CheckoutSettingsFile {
  path: string
  settings: Record<string, unknown>
}

export interface NeutralisedItem {
  file: string
  key: string
  how: string
}

export interface CheckoutVetting {
  askRules: string[]
  denyRules: string[]
  neutralised: NeutralisedItem[]
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const present = (value: unknown): boolean => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)

/** Missing files are skipped; anything else that is not a JSON object is refused, since it cannot be judged. */
export function readCheckoutSettings(checkoutDir: string): CheckoutSettingsFile[] {
  if (!isAbsolute(checkoutDir)) throw new PostureError('invalid_input', 'checkoutDir must be an absolute path')
  const files: CheckoutSettingsFile[] = []
  for (const name of CLAUDE_CHECKOUT_SETTINGS_FILES) {
    const path = join(checkoutDir, name)
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw new PostureError('checkout_settings_unreadable', `${path} cannot be read (${code ?? 'unknown error'}), so what it sets cannot be judged`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      parsed = undefined
    }
    if (!isObject(parsed)) throw new PostureError('checkout_settings_unreadable', `${path} is not a JSON object, so what it sets cannot be judged`)
    files.push({ path, settings: parsed })
  }
  return files
}

const BASELINE_RULE_FORMS = new Set(CLAUDE_BASELINE_ALLOWED_TOOLS.flatMap(rule => [rule, rule.replace(/ \*\)$/, ':*)')]))

/** A rule whose command part opens with a wildcard matches `bd` too, so mirroring it as ask makes `bd` prompt in this checkout. */
function coversBaseline(rule: string): boolean {
  return rule === 'Bash' || /^Bash\(\s*\*/.test(rule)
}

/** Ask outranks allow whatever file or front matter the allow comes from, so the checkout's approval turns into a prompt. */
export function mirrorAllowAsAsk(vetting: CheckoutVetting, file: string, key: string, rule: string): void {
  if (BASELINE_RULE_FORMS.has(rule)) return
  if (!vetting.askRules.includes(rule)) vetting.askRules.push(rule)
  vetting.neutralised.push({
    file,
    key: `${key} ${rule}`,
    how: coversBaseline(rule)
      ? 'mirrored as an ask rule in --settings, which outranks the allow; it also covers bd, so bd will prompt in this checkout'
      : 'mirrored as an ask rule in --settings, which outranks the allow',
  })
}

/**
 * Turns what the checkout's own settings would let through into entries for the launch's `--settings`:
 * allow rules become ask rules (ask outranks allow from any file), additional directories become Edit denials.
 */
export function vetCheckoutSettings(files: readonly CheckoutSettingsFile[], checkoutDir: string, writeScope: BotWriteScope): CheckoutVetting {
  const vetting: CheckoutVetting = { askRules: [], denyRules: [], neutralised: [] }
  const note = (file: string, key: string, how: string) => vetting.neutralised.push({ file, key, how })
  for (const { path: file, settings } of files) {
    for (const [key, reason] of Object.entries(CLAUDE_CHECKOUT_REFUSED_SETTINGS)) {
      const value = settings[key]
      if (present(value) && !(isObject(value) && Object.keys(value).length === 0)) {
        throw new PostureError('checkout_settings_widens', `${file} sets ${key}, which a bot session may not run with: ${reason}`)
      }
    }
    if (present(settings.hooks)) note(file, 'hooks', 'disableAllHooks: true in --settings turns every hook off')
    if (present(settings.agent)) note(file, 'agent', '--agent names the persona, which outranks the setting')
    if (present(settings.sandbox)) {
      note(file, 'sandbox', writeScope === 'write-auto'
        ? 'allowUnsandboxedCommands: false in --settings makes the CLI ignore the repository\'s sandbox entries'
        : 'sandbox.enabled: false in --settings keeps the sandbox and its auto-approval off')
    }
    if (present(settings.enableAllProjectMcpServers) || present(settings.enabledMcpjsonServers)) {
      note(file, 'enableAllProjectMcpServers', '--strict-mcp-config loads no MCP server from the checkout')
    }
    const permissions = settings.permissions
    if (present(permissions) && !isObject(permissions)) {
      throw new PostureError('checkout_settings_unreadable', `${file} sets permissions to something other than an object, so what it allows cannot be judged`)
    }
    if (!isObject(permissions)) continue
    if (present(permissions.defaultMode)) note(file, 'permissions.defaultMode', '--permission-mode and the --settings defaultMode outrank it')
    if (present(permissions.allow)) {
      if (!Array.isArray(permissions.allow)) throw new PostureError('checkout_settings_unreadable', `${file} sets permissions.allow to something other than a list`)
      for (const rule of permissions.allow) {
        if (typeof rule !== 'string') throw new PostureError('checkout_settings_unreadable', `${file} has a permissions.allow entry that is not a string`)
        mirrorAllowAsAsk(vetting, file, 'permissions.allow', rule)
      }
    }
    if (present(permissions.additionalDirectories)) {
      if (!Array.isArray(permissions.additionalDirectories)) throw new PostureError('checkout_settings_unreadable', `${file} sets permissions.additionalDirectories to something other than a list`)
      for (const dir of permissions.additionalDirectories) {
        if (typeof dir !== 'string') throw new PostureError('checkout_settings_unreadable', `${file} has a permissions.additionalDirectories entry that is not a string`)
        const absolute = dir.startsWith('~') ? dir : resolve(checkoutDir, dir)
        const rule = `Edit(${absolute.startsWith('~') ? absolute : `/${absolute}`}/**)`
        vetting.denyRules.push(rule)
        note(file, `permissions.additionalDirectories ${dir}`, `edits there are denied by ${rule} in --settings`)
      }
    }
  }
  return vetting
}

// Not switchable means nothing the user did earlier may win, so the shell reads a key no toggle ever writes.
export const LOCKED_STORAGE_KEY = 'cm-color-mode-locked'

/**
 * @param {{ default: 'light' | 'dark' | 'system', switchable: boolean }} colorMode
 * @returns {{ preference: string, storageKey?: string }}
 */
export function colorModeOptions({ default: preference, switchable }) {
  return switchable ? { preference } : { preference, storageKey: LOCKED_STORAGE_KEY }
}

export type HostPlatform = 'mac' | 'windows' | 'linux'

export interface PlatformNavigatorLike {
  platform?: string
  userAgent?: string
  userAgentData?: {
    platform?: string
  }
}

export interface ShortcutEntry {
  keys: string[]
  description: string
}

export interface ShortcutGroup {
  title: string
  items: ShortcutEntry[]
}

const REGEX_MAC = /Mac|iPhone|iPad|iPod|Darwin/i
const REGEX_WIN = /Win/i

/**
 * Detect the host operating system synchronously from browser navigator signals.
 * Falls back to `'linux'` when navigator is unavailable (e.g., SSR/Node tests).
 */
export function detectHostPlatform(
  nav: PlatformNavigatorLike | null = typeof navigator !== 'undefined' ? navigator : null,
): HostPlatform {
  if (!nav) return 'linux'
  const raw = nav.userAgentData?.platform || nav.platform || nav.userAgent || ''
  if (REGEX_MAC.test(raw)) return 'mac'
  if (REGEX_WIN.test(raw)) return 'windows'
  return 'linux'
}

/**
 * Return true when running on Apple platforms where `⌘` / `⌥` are standard.
 */
export function isMacPlatform(nav?: PlatformNavigatorLike | null): boolean {
  return detectHostPlatform(nav) === 'mac'
}

/**
 * Format a canonical shortcut string (e.g. `'Mod+K'`, `'Mod+Enter'`, `'Shift+Enter'`)
 * using consistent `+`-joined key labels for the active OS.
 */
export function formatShortcut(combo: string, isMac = isMacPlatform()): string {
  const tokenMap: Record<string, string> = {
    Mod: isMac ? '⌘' : 'Ctrl',
    Alt: isMac ? '⌥' : 'Alt',
    Shift: '⇧',
    Enter: '↵',
  }

  return combo
    .split('+')
    .map((part) => tokenMap[part] ?? part)
    .join('+')
}

/**
 * Return the OS-appropriate short symbol/label for the Alt/Option modifier.
 */
export function altKeyLabel(isMac = isMacPlatform()): string {
  return isMac ? '⌥' : 'Alt'
}

/**
 * Return the OS-appropriate human-readable name for the Alt/Option modifier.
 */
export function altKeyName(isMac = isMacPlatform()): string {
  return isMac ? 'Option' : 'Alt'
}

/**
 * Match the primary command modifier for the active OS (`⌘` on macOS, `Ctrl` elsewhere)
 * without matching the other platform's modifier simultaneously.
 */
export function isModKey(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>,
  isMac = isMacPlatform(),
): boolean {
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

/**
 * Canonical grouped keyboard shortcut reference shared by the `?` cheatsheet
 * modal and the Settings → Shortcuts panel.
 */
export function getShortcutGroups(isMac = isMacPlatform()): ShortcutGroup[] {
  return [
    {
      title: 'Tour Navigation',
      items: [
        { keys: ['O', '0'], description: 'Open or toggle PR Overview' },
        { keys: ['L', '→'], description: 'Next tour step' },
        { keys: ['H', '←'], description: 'Previous tour step' },
        { keys: ['N'], description: 'Jump to next unreviewed step' },
        { keys: ['J / ↓', 'K / ↑'], description: 'Smooth scroll down / up' },
        { keys: ['['], description: 'Toggle tour sidebar' },
      ],
    },
    {
      title: 'Diff, Search & Comments',
      items: [
        { keys: [formatShortcut('Mod+F', isMac)], description: 'Search within current file diff' },
        { keys: [formatShortcut('Shift+Enter', isMac)], description: 'Previous match in diff search' },
        {
          keys: [formatShortcut('Mod+K', isMac)],
          description: 'Jump to file, symbol, or unresolved thread',
        },
        {
          keys: [formatShortcut('Mod+Enter', isMac)],
          description: 'Submit comment or thread reply',
        },
        { keys: ['Esc'], description: 'Cancel composer, diff search, or modal' },
      ],
    },
    {
      title: 'PR Inbox',
      items: [
        { keys: ['/', formatShortcut('Mod+K', isMac)], description: 'Focus inbox search' },
        { keys: ['J / ↓', 'K / ↑'], description: 'Move PR selection down / up' },
        { keys: ['Enter'], description: 'Open selected PR' },
        { keys: ['Esc'], description: 'Clear or exit inbox search' },
      ],
    },
    {
      title: 'Review & App',
      items: [
        { keys: ['M'], description: 'Mark current step reviewed' },
        { keys: ['Z'], description: 'Toggle Zen / Focus mode' },
        { keys: ['R'], description: 'Finish & submit review' },
        { keys: [formatShortcut('Mod+,', isMac)], description: 'Open or close settings' },
        { keys: ['?'], description: 'Toggle keyboard shortcuts cheatsheet' },
      ],
    },
  ]
}

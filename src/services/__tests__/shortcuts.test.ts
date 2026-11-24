import { describe, expect, it } from 'vitest'
import {
  altKeyLabel,
  altKeyName,
  detectHostPlatform,
  formatShortcut,
  getShortcutGroups,
  isMacPlatform,
  isModKey,
} from '@/services/shortcuts'

describe('detectHostPlatform & isMacPlatform', () => {
  it('detects macOS from userAgentData, platform, or userAgent', () => {
    expect(detectHostPlatform({ userAgentData: { platform: 'macOS' } })).toBe('mac')
    expect(detectHostPlatform({ platform: 'MacIntel' })).toBe('mac')
    expect(detectHostPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe('mac')
    expect(isMacPlatform({ platform: 'MacARM' })).toBe(true)
  })

  it('detects Windows and Linux', () => {
    expect(detectHostPlatform({ userAgentData: { platform: 'Windows' } })).toBe('windows')
    expect(detectHostPlatform({ platform: 'Win32' })).toBe('windows')
    expect(detectHostPlatform({ platform: 'Linux x86_64' })).toBe('linux')
    expect(detectHostPlatform(null)).toBe('linux')
    expect(detectHostPlatform({})).toBe('linux')
    expect(isMacPlatform({ platform: 'Win32' })).toBe(false)
    expect(isMacPlatform({ platform: 'Linux x86_64' })).toBe(false)
  })
})

describe('formatShortcut & modifier helpers', () => {
  it('formats Mod, Alt, Shift, and Enter consistently with + on macOS', () => {
    expect(formatShortcut('Mod+K', true)).toBe('⌘+K')
    expect(formatShortcut('Mod+F', true)).toBe('⌘+F')
    expect(formatShortcut('Mod+,', true)).toBe('⌘+,')
    expect(formatShortcut('Mod+Enter', true)).toBe('⌘+↵')
    expect(formatShortcut('Shift+Enter', true)).toBe('⇧+↵')
    expect(formatShortcut('Alt+Hover', true)).toBe('⌥+Hover')
    expect(altKeyLabel(true)).toBe('⌥')
    expect(altKeyName(true)).toBe('Option')
  })

  it('formats Mod, Alt, Shift, and Enter consistently with + on Windows/Linux', () => {
    expect(formatShortcut('Mod+K', false)).toBe('Ctrl+K')
    expect(formatShortcut('Mod+F', false)).toBe('Ctrl+F')
    expect(formatShortcut('Mod+,', false)).toBe('Ctrl+,')
    expect(formatShortcut('Mod+Enter', false)).toBe('Ctrl+↵')
    expect(formatShortcut('Shift+Enter', false)).toBe('⇧+↵')
    expect(formatShortcut('Alt+Hover', false)).toBe('Alt+Hover')
    expect(altKeyLabel(false)).toBe('Alt')
    expect(altKeyName(false)).toBe('Alt')
  })

  it('matches only the OS-native primary modifier in isModKey', () => {
    expect(isModKey({ metaKey: true, ctrlKey: false }, true)).toBe(true)
    expect(isModKey({ metaKey: false, ctrlKey: true }, true)).toBe(false)
    expect(isModKey({ metaKey: true, ctrlKey: true }, true)).toBe(false)

    expect(isModKey({ metaKey: false, ctrlKey: true }, false)).toBe(true)
    expect(isModKey({ metaKey: true, ctrlKey: false }, false)).toBe(false)
    expect(isModKey({ metaKey: true, ctrlKey: true }, false)).toBe(false)
  })
})

describe('getShortcutGroups', () => {
  it('returns OS-specific shortcut labels without duplicating Cmd/Ctrl variants', () => {
    const macKeys = getShortcutGroups(true).flatMap((g) => g.items.flatMap((i) => i.keys))
    expect(macKeys).toContain('⌘+F')
    expect(macKeys).toContain('⌘+K')
    expect(macKeys).toContain('⌘+↵')
    expect(macKeys).toContain('⌘+,')
    expect(macKeys).toContain('⇧+↵')
    expect(macKeys.some((k) => k.includes('Ctrl'))).toBe(false)

    const linuxKeys = getShortcutGroups(false).flatMap((g) => g.items.flatMap((i) => i.keys))
    expect(linuxKeys).toContain('Ctrl+F')
    expect(linuxKeys).toContain('Ctrl+K')
    expect(linuxKeys).toContain('Ctrl+↵')
    expect(linuxKeys).toContain('Ctrl+,')
    expect(linuxKeys).toContain('⇧+↵')
    expect(linuxKeys.some((k) => k.includes('⌘'))).toBe(false)
  })
})

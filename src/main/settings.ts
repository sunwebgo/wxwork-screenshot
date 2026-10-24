import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export interface Settings {
  autoLaunch?: boolean
}

let cache: Settings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function load(): Settings {
  if (cache) return cache
  try {
    const raw = readFileSync(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw) as Settings
    cache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const next = { ...load(), ...patch }
  cache = next
  try {
    mkdirSync(dirname(settingsFile()), { recursive: true })
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    console.warn('write settings failed:', err)
  }
  return next
}

export function readSettings(): Settings {
  return { ...load() }
}

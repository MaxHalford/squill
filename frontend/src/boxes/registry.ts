import type { Component } from 'vue'
import type { BoxType } from '../types/canvas.d'
import type { DatabaseEngine } from '../types/database'
import { isTauri } from '../utils/tauri'

export interface BoxDefinition {
  type: BoxType
  label: string
  shortcut?: string
  defaultWidth: number
  defaultHeight: number
  generateName: (boxId: number, existingNames: string[]) => string
  defaultQuery?: (engine?: DatabaseEngine) => string
  component: Component
  showInNewMenu: boolean
  menuOrder?: number
  platforms?: ('web' | 'desktop')[]
  /** The prop name used to pass box.query data to the component */
  dataProp?: string
}

const registry = new Map<BoxType, BoxDefinition>()

export function registerBox(def: BoxDefinition): void {
  registry.set(def.type, def)
}

export function getBoxDefinition(type: BoxType): BoxDefinition | undefined {
  return registry.get(type)
}

export function getAllBoxDefinitions(): BoxDefinition[] {
  return [...registry.values()]
}

export function getMenuBoxDefinitions(): BoxDefinition[] {
  const platform = isTauri() ? 'desktop' : 'web'
  return getAllBoxDefinitions()
    .filter(d => d.showInNewMenu)
    .filter(d => !d.platforms || d.platforms.includes(platform))
    .sort((a, b) => (a.menuOrder ?? 99) - (b.menuOrder ?? 99))
}

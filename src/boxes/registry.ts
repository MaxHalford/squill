import type { Component } from 'vue'
import type { BoxType } from '../types/canvas.d'
import type { DatabaseEngine } from '../types/database'

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
  /** Which database engines this box supports. Omit for all engines. */
  supportedEngines?: DatabaseEngine[]
  /** The prop name used to pass box.query data to the component */
  dataProp?: 'initialQuery' | 'initialContent' | 'initialRowData' | 'initialData'
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
  return getAllBoxDefinitions()
    .filter(d => d.showInNewMenu)
    .sort((a, b) => (a.menuOrder ?? 99) - (b.menuOrder ?? 99))
}

export function isBoxSupportedForEngine(def: BoxDefinition, engine: DatabaseEngine): boolean {
  return !def.supportedEngines || def.supportedEngines.includes(engine)
}

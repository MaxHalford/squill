import { defineAsyncComponent } from 'vue'
import { registerBox } from '../registry'
import { getDefaultQuery } from '../../constants/defaultQueries'
import type { DatabaseEngine } from '../../types/database'

const TREE_NAMES = [
  'Oak', 'Pine', 'Maple', 'Birch', 'Cedar', 'Willow', 'Elm', 'Ash',
  'Beech', 'Spruce', 'Fir', 'Walnut', 'Cherry', 'Apple', 'Pear', 'Plum',
  'Peach', 'Olive', 'Palm', 'Cypress', 'Juniper', 'Hemlock', 'Hickory',
  'Chestnut', 'Magnolia', 'Dogwood', 'Redwood', 'Sequoia', 'Acacia', 'Aspen',
  'Alder', 'Poplar', 'Larch', 'Yew', 'Holly', 'Hazel', 'Rowan', 'Laurel',
  'Myrtle', 'Banyan', 'Baobab', 'Bamboo', 'Teak', 'Ebony', 'Mahogany',
  'Sycamore', 'Mulberry', 'Hawthorn', 'Tamarind', 'Buckeye', 'Fig', 'Linden',
  'Locust', 'Mimosa', 'Catalpa', 'Ginkgo', 'Tupelo', 'Osage',
]

const getUniqueTreeName = (existingNames: string[]): string => {
  const usedNames = new Set(existingNames.map(n => n.toLowerCase()))
  const available = TREE_NAMES.filter(name => !usedNames.has(name.toLowerCase()))

  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)].toLowerCase()
  }

  let suffix = 2
  while (true) {
    const candidate = `${TREE_NAMES[Math.floor(Math.random() * TREE_NAMES.length)].toLowerCase()} ${suffix}`
    if (!usedNames.has(candidate)) {
      return candidate
    }
    suffix++
  }
}

registerBox({
  type: 'sql',
  label: 'SQL editor',
  shortcut: '&#x2318;J',
  defaultWidth: 600,
  defaultHeight: 500,
  generateName: (_id: number, existing: string[]) => getUniqueTreeName(existing),
  defaultQuery: (engine?: DatabaseEngine) => getDefaultQuery(engine),
  component: defineAsyncComponent(() => import('./SqlBox.vue')),
  showInNewMenu: true,
  menuOrder: 1,
  dataProp: 'initialQuery',
})

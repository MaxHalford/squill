import { defineAsyncComponent } from 'vue'
import { registerBox } from '../registry'

registerBox({
  type: 'analytics',
  label: 'Pivot table',
  defaultWidth: 800,
  defaultHeight: 500,
  generateName: (id: number) => `analytics_${id}`,
  component: defineAsyncComponent(() => import('./PivotBox.vue')),
  showInNewMenu: false,
  dataProp: 'initialData',
})

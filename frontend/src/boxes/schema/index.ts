import { defineAsyncComponent } from 'vue'
import { registerBox } from '../registry'

registerBox({
  type: 'schema',
  label: 'Schema browser',
  defaultWidth: 800,
  defaultHeight: 600,
  generateName: () => 'Schema browser',
  component: defineAsyncComponent(() => import('./SchemaBox.vue')),
  showInNewMenu: true,
  menuOrder: 3,
})

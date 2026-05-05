import { defineAsyncComponent } from 'vue'
import { registerBox } from '../registry'

registerBox({
  type: 'history',
  label: 'Query history',
  defaultWidth: 700,
  defaultHeight: 500,
  generateName: () => 'Query history',
  component: defineAsyncComponent(() => import('./HistoryBox.vue')),
  showInNewMenu: true,
  menuOrder: 4,
})

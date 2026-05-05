import { defineAsyncComponent } from 'vue'
import { registerBox } from '../registry'

registerBox({
  type: 'explain',
  label: 'Explain plan',
  defaultWidth: 600,
  defaultHeight: 500,
  generateName: (id: number) => `explain_${id}`,
  component: defineAsyncComponent(() => import('./ExplainBox.vue')),
  showInNewMenu: false,
  dataProp: 'initialData',
})

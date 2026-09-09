import { defineAsyncComponent } from 'vue'
import { registerBox } from '../registry'

registerBox({
  type: 'detail',
  label: 'Row detail',
  defaultWidth: 400,
  defaultHeight: 500,
  generateName: (id: number) => `row_detail_${id}`,
  component: defineAsyncComponent(() => import('./RowDetailBox.vue')),
  showInNewMenu: false,
  dataProp: 'initialRowData',
})

import { defineAsyncComponent } from 'vue'
import { registerBox } from '../registry'

registerBox({
  type: 'note',
  label: 'Sticky note',
  defaultWidth: 400,
  defaultHeight: 300,
  generateName: (id: number) => `note_${id}`,
  component: defineAsyncComponent(() => import('./StickyNoteBox.vue')),
  showInNewMenu: true,
  menuOrder: 2,
  dataProp: 'initialContent',
})

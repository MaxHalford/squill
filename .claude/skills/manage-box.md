# Managing Box Types

Guide for adding, removing, or disabling box types in the Squill canvas.

## Architecture

Boxes are self-contained modules under `frontend/src/boxes/<type>/`. Each box folder has:
- `index.ts` -- registers the box via `registerBox()` with metadata (dimensions, name, menu entry, platform, component)
- `*.vue` -- the component(s)

The registry (`frontend/src/boxes/registry.ts`) drives all box behavior: canvas store uses it for `addBox()`/`copyBox()` defaults, MenuBar renders menu entries from it, Home.vue resolves components from it.

## Adding a New Box Type

### 1. Add the type to the union

**File: `frontend/src/types/canvas.d.ts`**

```typescript
export type BoxType = 'sql' | 'schema' | 'note' | 'detail' | 'analytics' | 'history' | 'explain' | 'mybox'
```

**File: `frontend/src/utils/storageSchemas.ts`**

Add the same value to the `BoxTypeSchema` Zod enum so persisted data validates:

```typescript
const BoxTypeSchema = z.enum(['sql', 'schema', 'note', 'detail', 'analytics', 'history', 'explain', 'mybox'])
```

### 2. Create the box folder

```
frontend/src/boxes/mybox/
  index.ts
  MyBox.vue
```

**`index.ts`** -- register metadata + lazy component:

```typescript
import { defineAsyncComponent } from 'vue'
import { registerBox } from '../registry'

registerBox({
  type: 'mybox',
  label: 'My box',             // display name in menu
  // shortcut: '&#x2318;K',    // optional keyboard shortcut (HTML entity)
  defaultWidth: 600,
  defaultHeight: 400,
  generateName: (id: number) => `mybox_${id}`,
  component: defineAsyncComponent(() => import('./MyBox.vue')),
  showInNewMenu: true,          // false = only created programmatically
  menuOrder: 5,                 // sort position in "New" menu
  // platforms: ['web'],        // omit for both web + desktop
  // supportedEngines: ['duckdb'], // omit for all engines; restricts which DB engines can use this box
  dataProp: 'initialData',     // prop name to receive box.query data (omit if none)
})
```

**`MyBox.vue`** -- minimal skeleton:

```vue
<script setup lang="ts">
import BaseBox from '../../components/BaseBox.vue'
// ... your imports from ../../stores/, ../../utils/, ../../types/, etc.
</script>

<template>
  <BaseBox
    :box-id="boxId"
    :initial-x="initialX"
    :initial-y="initialY"
    :initial-width="initialWidth"
    :initial-height="initialHeight"
    :initial-z-index="initialZIndex"
    :initial-name="initialName"
    :is-selected="isSelected"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @update:name="emit('update:name', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @drag-start="emit('drag-start')"
    @drag-end="emit('drag-end')"
  >
    <!-- your content -->
  </BaseBox>
</template>
```

All boxes get BaseBox props/events for free (drag, resize, select, delete, maximize, name editing). See `frontend/src/boxes/note/StickyNoteBox.vue` for a minimal real example.

### 3. Register the import

**File: `frontend/src/boxes/index.ts`**

```typescript
import './mybox'
```

### 4. Wire custom events (if any)

If your box emits custom events beyond BaseBox's standard set, add a case in `getExtraEvents()`:

**File: `frontend/src/views/Home.vue`** (~line 850, `getExtraEvents` function)

```typescript
case 'mybox':
  events['my-custom-event'] = handleMyCustomEvent
  break
```

If your box needs extra props beyond what `dataProp` handles, add them in `getExtraProps()` (~line 836).

If your box exposes imperative methods (like SqlBox's `focusEditor`), add ref registration in `registerBoxRef()` (~line 826).

### 5. Verify

- `cd frontend && npx vue-tsc --noEmit` -- type check
- `prek run --all-files` -- full pre-commit (types + lint + tests)
- Run dev server and create the box from the "New" menu
- Copy the box (Cmd+D) and verify it gets a new name
- Undo/redo box creation

## Removing a Box Type

1. Remove the folder `frontend/src/boxes/<type>/`
2. Remove the import from `frontend/src/boxes/index.ts`
3. Remove the type from `BoxType` in `frontend/src/types/canvas.d.ts`
4. Remove from `BoxTypeSchema` in `frontend/src/utils/storageSchemas.ts`
5. Remove any custom event/prop/ref wiring in `Home.vue` (`getExtraEvents`, `getExtraProps`, `registerBoxRef`)
6. Remove any handler functions in `Home.vue` that were only used by this box type
7. Search for remaining references: `grep -r "mybox" frontend/src/`

## Disabling a Box for Desktop or Web

Use the `platforms` field in the box's `index.ts`:

```typescript
registerBox({
  type: 'mybox',
  // ...
  platforms: ['web'],       // web only -- hidden from Tauri desktop
  // platforms: ['desktop'], // desktop only -- hidden from web
  // omit platforms entirely for both
})
```

This controls:
- **Menu visibility** -- `getMenuBoxDefinitions()` filters by current platform
- **addBox()** -- the box can still be created programmatically (e.g., from another box's action), but won't appear in the "New" menu

To fully prevent creation on a platform (not just hide from menu), add a guard in the box's `index.ts`:

```typescript
import { isTauri } from '../../utils/tauri'

if (!isTauri()) {
  registerBox({ /* ... */ })
}
```

This skips registration entirely, so `addBox()` will throw for that type on the excluded platform.

## Restricting a Box to Specific Database Engines

Use the `supportedEngines` field in the box's `index.ts`:

```typescript
import type { DatabaseEngine } from '../../types/database'

registerBox({
  type: 'mybox',
  // ...
  supportedEngines: ['duckdb'],                    // DuckDB only
  // supportedEngines: ['duckdb', 'clickhouse'],   // DuckDB + ClickHouse
  // omit supportedEngines entirely for all engines
})
```

This controls:
- **Menu visibility** -- MenuBar grays out the item when the active connection's engine is not in the list, with a tooltip like "My box is not available for BigQuery"
- **addBox() guard** -- MenuBar's `addBox()` silently ignores clicks on disabled items
- The box can still be created programmatically from code that passes the right engine

Helper to check support from any code:

```typescript
import { getBoxDefinition, isBoxSupportedForEngine } from '../boxes'

const def = getBoxDefinition('mybox')
if (def && isBoxSupportedForEngine(def, engine)) { /* ok */ }
```

## Reference

- Registry: `frontend/src/boxes/registry.ts` -- `BoxDefinition` interface, `isBoxSupportedForEngine()` helper
- Simple box example: `frontend/src/boxes/note/` (StickyNoteBox)
- Complex box example: `frontend/src/boxes/sql/` (SqlBox with tree names, default queries)
- Rendering: `frontend/src/views/Home.vue` -- `getBoxComponent`, `getExtraProps`, `getExtraEvents`, `registerBoxRef`
- Canvas store: `frontend/src/stores/canvas.ts` -- `addBox()`, `copyBox()`, `copyMultipleBoxes()` use registry
- Menu: `frontend/src/components/MenuBar.vue` -- iterates `getMenuBoxDefinitions()`

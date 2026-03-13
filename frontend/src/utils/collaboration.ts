import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import type { Box } from '../types/canvas'

export const HOCUSPOCUS_URL = import.meta.env.VITE_HOCUSPOCUS_URL || 'ws://localhost:1234'

export interface CursorState {
  x: number
  y: number
  color: string
  name: string
  clientId: number
}

export interface CollaborationSession {
  doc: Y.Doc
  provider: HocuspocusProvider
  boxesArray: Y.Array<Y.Map<unknown>>
  canvasMap: Y.Map<unknown>
  undoManager: Y.UndoManager
  canvasId: string
  awareness: HocuspocusProvider['awareness']
}

export function createCollaborationSession(
  canvasId: string,
  token: string,
): CollaborationSession {
  const doc = new Y.Doc()
  const boxesArray = doc.getArray<Y.Map<unknown>>('boxes')
  const canvasMap = doc.getMap<unknown>('canvas')
  const undoManager = new Y.UndoManager([boxesArray, canvasMap])

  const provider = new HocuspocusProvider({
    url: HOCUSPOCUS_URL,
    name: `canvas:${canvasId}`,
    token,
    document: doc,
  })

  return { doc, provider, boxesArray, canvasMap, undoManager, canvasId, awareness: provider.awareness }
}

export function destroyCollaborationSession(session: CollaborationSession): void {
  session.provider.destroy()
  session.doc.destroy()
}

export function ymapToBox(ymap: Y.Map<unknown>): Box {
  return {
    id: ymap.get('id') as number,
    type: ymap.get('type') as Box['type'],
    x: ymap.get('x') as number,
    y: ymap.get('y') as number,
    width: ymap.get('width') as number,
    height: ymap.get('height') as number,
    zIndex: ymap.get('zIndex') as number,
    query: ymap.get('query') as string,
    name: ymap.get('name') as string,
    dependencies: (ymap.get('dependencies') as number[]) ?? [],
    connectionId: ymap.get('connectionId') as string | undefined,
    editorHeight: ymap.get('editorHeight') as number | undefined,
  }
}

export function boxToYmap(box: Box): Y.Map<unknown> {
  const ymap = new Y.Map<unknown>()
  ymap.set('id', box.id)
  ymap.set('type', box.type)
  ymap.set('x', box.x)
  ymap.set('y', box.y)
  ymap.set('width', box.width)
  ymap.set('height', box.height)
  ymap.set('zIndex', box.zIndex)
  ymap.set('query', box.query)
  ymap.set('name', box.name)
  ymap.set('dependencies', box.dependencies)
  if (box.connectionId !== undefined) ymap.set('connectionId', box.connectionId)
  if (box.editorHeight !== undefined) ymap.set('editorHeight', box.editorHeight)
  return ymap
}

/**
 * Canvas API service — REST functions for server-first canvas state.
 * Follows existing patterns: native fetch, VITE_BACKEND_URL, Bearer auth.
 */

import { BACKEND_URL } from '@/services/backend'

interface BoxResponse {
  box_id: number
  state: Record<string, unknown>
}

interface CanvasSnapshotResponse {
  id: string
  name: string
  version: number
  next_box_id: number
  boxes: BoxResponse[]
  created_at: string
  updated_at: string
}

interface CanvasListItem {
  id: string
  name: string
  created_at: string
  updated_at: string
}

async function authFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || `Request failed: ${response.status}`)
  }
  return response
}

export async function fetchCanvasList(
  token: string,
): Promise<CanvasListItem[]> {
  const response = await authFetch('/canvas', token)
  const data = await response.json()
  return data.canvases
}

export async function fetchCanvasSnapshot(
  canvasId: string,
  token: string,
): Promise<CanvasSnapshotResponse> {
  const response = await authFetch(`/canvas/${canvasId}/snapshot`, token)
  return response.json()
}

export async function createServerCanvas(
  canvasId: string,
  name: string,
  token: string,
): Promise<CanvasListItem> {
  const response = await authFetch('/canvas', token, {
    method: 'POST',
    body: JSON.stringify({ id: canvasId, name }),
  })
  return response.json()
}

export async function createBox(
  canvasId: string,
  state: Record<string, unknown>,
  token: string,
): Promise<BoxResponse> {
  const response = await authFetch(`/canvas/${canvasId}/boxes`, token, {
    method: 'POST',
    body: JSON.stringify({ state }),
  })
  return response.json()
}

export async function createBoxesBatch(
  canvasId: string,
  boxes: Record<string, unknown>[],
  token: string,
): Promise<BoxResponse[]> {
  const response = await authFetch(`/canvas/${canvasId}/boxes/batch`, token, {
    method: 'POST',
    body: JSON.stringify({ boxes }),
  })
  return response.json()
}

export async function updateBox(
  canvasId: string,
  boxId: number,
  fields: Record<string, unknown>,
  token: string,
): Promise<BoxResponse> {
  const response = await authFetch(
    `/canvas/${canvasId}/boxes/${boxId}`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    },
  )
  return response.json()
}

export async function updateBoxesBatch(
  canvasId: string,
  updates: { box_id: number; fields: Record<string, unknown> }[],
  token: string,
): Promise<BoxResponse[]> {
  const response = await authFetch(
    `/canvas/${canvasId}/boxes/batch`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({ updates }),
    },
  )
  return response.json()
}

export async function deleteBox(
  canvasId: string,
  boxId: number,
  token: string,
): Promise<void> {
  await authFetch(`/canvas/${canvasId}/boxes/${boxId}`, token, {
    method: 'DELETE',
  })
}

export async function deleteBoxesBatch(
  canvasId: string,
  boxIds: number[],
  token: string,
): Promise<void> {
  await authFetch(`/canvas/${canvasId}/boxes/batch-delete`, token, {
    method: 'POST',
    body: JSON.stringify({ box_ids: boxIds }),
  })
}

export async function importCanvasState(
  canvasId: string,
  boxes: Record<string, unknown>[],
  nextBoxId: number,
  token: string,
): Promise<CanvasSnapshotResponse> {
  const response = await authFetch(`/canvas/${canvasId}/import`, token, {
    method: 'POST',
    body: JSON.stringify({ boxes, next_box_id: nextBoxId }),
  })
  return response.json()
}

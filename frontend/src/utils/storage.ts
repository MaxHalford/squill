import Dexie from 'dexie'
import { db, dbReady } from './db'

// Strip Vue reactive proxies before storing — IndexedDB's structured clone
// algorithm can't handle Proxy objects. Dexie.deepClone handles Dates,
// ArrayBuffers, and Blobs unlike JSON round-trip.
function toPlain<T>(value: T): T {
  return Dexie.deepClone(value) as T
}

// ---- appData table (general app state) ----

export async function loadItem<T>(key: string): Promise<T | undefined> {
  await dbReady
  const row = await db.appData.get(key)
  return row?.value as T | undefined
}

export async function saveItem(key: string, value: unknown): Promise<void> {
  await dbReady
  await db.appData.put({ key, value: toPlain(value) })
}

export async function deleteItem(key: string): Promise<void> {
  await dbReady
  await db.appData.delete(key)
}

// ---- schemas table (BigQuery schemas, kept separate due to size) ----

export async function loadSchema<T>(key: string): Promise<T | undefined> {
  await dbReady
  const row = await db.schemas.get(key)
  return row?.value as T | undefined
}

export async function saveSchema(key: string, value: unknown): Promise<void> {
  await dbReady
  await db.schemas.put({ key, value: toPlain(value) })
}

export async function clearSchemas(): Promise<void> {
  await dbReady
  await db.schemas.clear()
}

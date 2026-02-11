import Dexie, { type Table } from 'dexie'

export interface KVEntry<T = unknown> {
  key: string
  value: T
}

class SquillDB extends Dexie {
  appData!: Table<KVEntry, string>
  schemas!: Table<KVEntry, string>

  constructor() {
    super('squill')

    this.version(1).stores({
      appData: 'key',
      schemas: 'key',
    })
  }
}

export const db = new SquillDB()

/**
 * Eagerly open the database and handle schema conflicts.
 * If a pre-existing database with an incompatible schema exists
 * (e.g. from before the Dexie migration), delete and recreate it.
 * All storage operations await this promise before proceeding.
 */
export const dbReady: Promise<void> = db.open().then(() => {}).catch(async (err) => {
  if (err.name === 'UpgradeError' || err?.inner?.name === 'UpgradeError') {
    console.warn('Database schema conflict detected, recreating database...')
    await db.delete()
    await db.open()
  } else {
    throw err
  }
})

/**
 * Delete the entire database (for "reset all data" flows).
 * After calling this, the page should be reloaded.
 */
export async function deleteDatabase(): Promise<void> {
  await db.delete()
}

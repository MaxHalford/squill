const files = import.meta.glob('./changelog/*.md', { eager: true, query: '?raw', import: 'default' })

export interface ChangelogEntry {
  date: string
  content: string
}

export const changelog: ChangelogEntry[] = Object.entries(files)
  .map(([path, content]) => ({
    date: path.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] ?? '',
    content: content as string,
  }))
  .filter((entry) => entry.date !== '')
  .sort((a, b) => b.date.localeCompare(a.date))

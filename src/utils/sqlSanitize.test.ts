import { describe, expect, it } from 'vitest'
import {
  buildLocalDataReaderSql,
  generateUniqueTableName,
  getLocalDataFormat,
  isLocalDataFileName,
} from './sqlSanitize'

describe('local data file formats', () => {
  it.each([
    ['events.parquet', 'parquet'],
    ['events.PARQ', 'parquet'],
    ['events.pq', 'parquet'],
    ['events.csv', 'csv'],
    ['events.TSV', 'tsv'],
    ['events.json', 'json'],
    ['events.jsonl', 'json'],
    ['events.NDJSON', 'json'],
  ] as const)('recognizes %s as %s', (filename, format) => {
    expect(getLocalDataFormat(filename)).toBe(format)
    expect(isLocalDataFileName(filename)).toBe(true)
  })

  it.each(['events.txt', 'events.json.gz', 'parquet', '.csv.bak'])('rejects %s', (filename) => {
    expect(getLocalDataFormat(filename)).toBeNull()
    expect(isLocalDataFileName(filename)).toBe(false)
  })

  it.each([
    ['parquet', "read_parquet('upload.parquet')"],
    ['csv', "read_csv_auto('upload.csv')"],
    ['tsv', "read_csv_auto('upload.tsv', delim = '\\t')"],
    ['json', "read_json_auto('upload.json')"],
  ] as const)('builds the %s reader SQL', (format, expected) => {
    expect(buildLocalDataReaderSql(format, `upload.${format}`)).toBe(expected)
  })

  it('escapes registered filenames in reader SQL', () => {
    expect(buildLocalDataReaderSql('csv', "user's.csv"))
      .toBe("read_csv_auto('user''s.csv')")
  })
})

describe('generateUniqueTableName', () => {
  it('creates a SQL-safe name from a local data filename', () => {
    expect(generateUniqueTableName('Sales Data.parquet', {})).toBe('sales_data')
  })

  it.each(['parquet', 'parq', 'pq', 'csv', 'tsv', 'json', 'jsonl', 'ndjson'])(
    'removes the .%s extension',
    extension => {
      expect(generateUniqueTableName(`events.${extension}`, {})).toBe('events')
    },
  )

  it('creates unique names for the same base across formats', () => {
    const existing = { events: {}, events_1: {}, events_2: {} }
    expect(generateUniqueTableName('events.ndjson', existing)).toBe('events_3')
  })

  it('does not replace an existing table', () => {
    expect(generateUniqueTableName('events.parquet', { events: {}, events_1: {} })).toBe('events_2')
  })

  it('uses a non-empty fallback name', () => {
    expect(generateUniqueTableName('.jsonl', {})).toBe('imported_data')
  })
})

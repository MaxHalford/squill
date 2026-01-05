export type QueryEngine = 'duckdb' | 'bigquery'

export const DEFAULT_QUERIES: Record<QueryEngine, string> = {
  duckdb: `SELECT * FROM (
    VALUES
        ('Eleven', 'Millie Bobby Brown', 'Main', 1),
        ('Mike Wheeler', 'Finn Wolfhard', 'Main', 1),
        ('Dustin Henderson', 'Gaten Matarazzo', 'Main', 1),
        ('Lucas Sinclair', 'Caleb McLaughlin', 'Main', 1),
        ('Will Byers', 'Noah Schnapp', 'Main', 1),
        ('Joyce Byers', 'Winona Ryder', 'Main', 1),
        ('Jim Hopper', 'David Harbour', 'Main', 1),
        ('Nancy Wheeler', 'Natalia Dyer', 'Main', 1),
        ('Jonathan Byers', 'Charlie Heaton', 'Main', 1),
        ('Steve Harrington', 'Joe Keery', 'Main', 1),
        ('Max Mayfield', 'Sadie Sink', 'Main', 2),
        ('Robin Buckley', 'Maya Hawke', 'Main', 3),
        ('Eddie Munson', 'Joseph Quinn', 'Main', 4)
) AS characters(character_name, actor_name, role_type, first_appearance_season)
ORDER BY first_appearance_season, character_name`,

  bigquery: `SELECT *
FROM bigquery-public-data.samples.shakespeare
LIMIT 50`
}

export const getDefaultQuery = (engine?: QueryEngine | null): string => {
  return DEFAULT_QUERIES[engine || 'bigquery']
}

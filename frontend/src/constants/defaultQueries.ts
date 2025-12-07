export type QueryEngine = 'duckdb' | 'bigquery' | 'postgres'

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
FROM bigquery-public-data.samples.shakespeare`,

  postgres: `WITH authors (id, name) AS (
    VALUES
        (1, 'Rudyard Kipling'),
        (2, 'Robert Frost'),
        (3, 'Emily Dickinson'),
        (4, 'William Shakespeare'),
        (5, 'Edgar Allan Poe'),
        (6, 'Maya Angelou')
),
poems (title, author_id, year_published) AS (
    VALUES
        ('If', 1, 1910),
        ('The Road Not Taken', 2, 1916),
        ('Hope is the Thing with Feathers', 3, 1861),
        ('Sonnet 18', 4, 1609),
        ('The Raven', 5, 1845),
        ('Still I Rise', 6, 1978)
)
SELECT
    p.title,
    a.name AS author,
    p.year_published
FROM poems p
JOIN authors a ON p.author_id = a.id
ORDER BY p.year_published`
}

export const getDefaultQuery = (engine?: QueryEngine | null): string => {
  return DEFAULT_QUERIES[engine || 'bigquery']
}

export const DEFAULT_NOTE_CONTENT = 'Hello there.'

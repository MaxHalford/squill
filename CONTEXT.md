The app does not currently handle well large query results. The problem is that both BigQuery (in the client) and Postgres (through the server) load the entire result set into JavaScript arrays, before loading them into DuckDB.

I want to do a complete overhaul by using pagination:

- Query results should be paginated. I want to use a default pagination size of 9000 rows. This should leverage the existing setting and needs to be turned on by default.
- The pagination used to display results in the UI should be independent of the pagination used to fetch results from the database. For example, I want to fetch 9000 rows at a time from the database, but display only 100 rows at a time in the UI.
- The statistics shown in the UI (total rows, number of pages, etc.) should reflect the entire result set, not just the rows fetched so far.
- While I go through the pages, if I go past the rows fetched so far, the app should automatically fetch the next batch of rows from the database. This should be efficient thanks to pagination.

As a consequence, I also want to refactor the column analytics logic. Instead of leveraging DuckDB's built-in analytics functions, I want to run the analytics queries directly on the source database. This will ensure that the analytics are run over all source rows, not just the rows fetched so far. Therefore the column analytics queries will vary depending on the source database (e.g., Postgres, BigQuery, etc.). Of course these results should be paginated as well, using the same settings as above.

I still want query results to be loaded into DuckDB. Mind you, this should be done asynchronously in the background, so that the user can start exploring the first few rows of the result set while the rest is being loaded into DuckDB. I should still be able to click on the + boxes to generate a new query DuckDB based on the current result set, even if not all rows have been loaded into DuckDB yet. In that case, the new query should be run against the rows currently loaded into DuckDB, and then updated as more rows are loaded.

Please take your time to think through the design and implementation details. Consider edge cases, performance implications, and user experience. Once you have a solid plan, proceed with the implementation.

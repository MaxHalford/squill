import { SQLDialect } from '@codemirror/lang-sql'

export const BigQueryDialect = SQLDialect.define({
  // BigQuery-specific keywords
  keywords: 'select from where join inner left right full cross on using ' +
    'group by having order asc desc limit offset union all distinct ' +
    'with recursive as case when then else end ' +
    'create table view if not exists or replace temp temporary ' +
    'insert into values update set delete truncate drop ' +
    'and or not in is null like between exists ' +
    // BigQuery-specific
    'qualify window partition over rows range unbounded preceding following ' +
    'struct array unnest safe_cast',

  // BigQuery data types
  types: 'int64 float64 numeric bignumeric bool boolean string bytes ' +
    'date datetime time timestamp interval geography json ' +
    'struct array',

  // BigQuery built-in functions
  builtin: 'count sum avg min max stddev variance ' +
    'current_date current_datetime current_time current_timestamp ' +
    'extract date_diff datetime_diff timestamp_diff ' +
    'cast safe_cast format parse_date parse_datetime parse_timestamp ' +
    'generate_uuid generate_array array_length array_concat ' +
    'string_agg concat length lower upper trim substr replace split ' +
    'regexp_contains regexp_extract regexp_replace ' +
    'row_number rank dense_rank ntile lag lead first_value last_value',

  operatorChars: '*/+-%<>!=&|^~',
  specialVar: '@@',
  identifierQuotes: '`',
  charSetCasts: true,
  doubleQuotedStrings: false,
  unquotedBitLiterals: true,
  treatBitsAsBytes: true
})

import type { CompletionContext, Completion, CompletionSource } from '@codemirror/autocomplete'

// Boosted SQL keywords for autocompletion
// Higher boost values = shown first in the completion list
const boostedKeywords: Completion[] = [
  // Core query structure (highest priority)
  { label: 'SELECT', type: 'keyword', boost: 99 },
  { label: 'FROM', type: 'keyword', boost: 99 },
  { label: 'WHERE', type: 'keyword', boost: 98 },
  { label: 'AS', type: 'keyword', boost: 97 },

  // Logical operators (very common)
  { label: 'AND', type: 'keyword', boost: 95 },
  { label: 'OR', type: 'keyword', boost: 94 },
  { label: 'NOT', type: 'keyword', boost: 93 },
  { label: 'IN', type: 'keyword', boost: 92 },
  { label: 'IS', type: 'keyword', boost: 91 },
  { label: 'NULL', type: 'keyword', boost: 90 },
  { label: 'LIKE', type: 'keyword', boost: 89 },
  { label: 'BETWEEN', type: 'keyword', boost: 88 },

  // Joins (high priority)
  { label: 'JOIN', type: 'keyword', boost: 85 },
  { label: 'LEFT', type: 'keyword', boost: 84 },
  { label: 'RIGHT', type: 'keyword', boost: 83 },
  { label: 'INNER', type: 'keyword', boost: 82 },
  { label: 'OUTER', type: 'keyword', boost: 81 },
  { label: 'FULL', type: 'keyword', boost: 80 },
  { label: 'CROSS', type: 'keyword', boost: 79 },
  { label: 'ON', type: 'keyword', boost: 78 },
  { label: 'USING', type: 'keyword', boost: 77 },

  // Grouping and ordering
  { label: 'GROUP', type: 'keyword', boost: 75 },
  { label: 'ORDER', type: 'keyword', boost: 74 },
  { label: 'BY', type: 'keyword', boost: 73 },
  { label: 'HAVING', type: 'keyword', boost: 72 },
  { label: 'ASC', type: 'keyword', boost: 71 },
  { label: 'DESC', type: 'keyword', boost: 70 },

  // Pagination
  { label: 'LIMIT', type: 'keyword', boost: 68 },
  { label: 'OFFSET', type: 'keyword', boost: 67 },

  // Set operations
  { label: 'UNION', type: 'keyword', boost: 65 },
  { label: 'ALL', type: 'keyword', boost: 64 },
  { label: 'DISTINCT', type: 'keyword', boost: 63 },
  { label: 'EXCEPT', type: 'keyword', boost: 62 },
  { label: 'INTERSECT', type: 'keyword', boost: 61 },

  // CTEs and subqueries
  { label: 'WITH', type: 'keyword', boost: 60 },
  { label: 'RECURSIVE', type: 'keyword', boost: 59 },
  { label: 'EXISTS', type: 'keyword', boost: 58 },

  // Case expressions
  { label: 'CASE', type: 'keyword', boost: 55 },
  { label: 'WHEN', type: 'keyword', boost: 54 },
  { label: 'THEN', type: 'keyword', boost: 53 },
  { label: 'ELSE', type: 'keyword', boost: 52 },
  { label: 'END', type: 'keyword', boost: 51 },

  // Window functions
  { label: 'OVER', type: 'keyword', boost: 48 },
  { label: 'PARTITION', type: 'keyword', boost: 47 },
  { label: 'WINDOW', type: 'keyword', boost: 46 },
  { label: 'ROWS', type: 'keyword', boost: 45 },
  { label: 'RANGE', type: 'keyword', boost: 44 },
  { label: 'UNBOUNDED', type: 'keyword', boost: 43 },
  { label: 'PRECEDING', type: 'keyword', boost: 42 },
  { label: 'FOLLOWING', type: 'keyword', boost: 41 },
  { label: 'CURRENT', type: 'keyword', boost: 40 },

  // DML operations
  { label: 'INSERT', type: 'keyword', boost: 35 },
  { label: 'INTO', type: 'keyword', boost: 34 },
  { label: 'VALUES', type: 'keyword', boost: 33 },
  { label: 'UPDATE', type: 'keyword', boost: 32 },
  { label: 'SET', type: 'keyword', boost: 31 },
  { label: 'DELETE', type: 'keyword', boost: 30 },

  // DDL operations
  { label: 'CREATE', type: 'keyword', boost: 25 },
  { label: 'TABLE', type: 'keyword', boost: 24 },
  { label: 'VIEW', type: 'keyword', boost: 23 },
  { label: 'DROP', type: 'keyword', boost: 22 },
  { label: 'ALTER', type: 'keyword', boost: 21 },
  { label: 'TRUNCATE', type: 'keyword', boost: 20 },

  // Constraints and modifiers
  { label: 'IF', type: 'keyword', boost: 18 },
  { label: 'REPLACE', type: 'keyword', boost: 17 },
  { label: 'TEMP', type: 'keyword', boost: 16 },
  { label: 'TEMPORARY', type: 'keyword', boost: 15 },

  // Type casting
  { label: 'CAST', type: 'keyword', boost: 12 },

  // Boolean literals
  { label: 'TRUE', type: 'keyword', boost: 10 },
  { label: 'FALSE', type: 'keyword', boost: 9 },
]

/**
 * Completion source that provides boosted SQL keywords
 * This ensures common keywords appear at the top of the completion list
 */
export function boostedSqlKeywords(context: CompletionContext) {
  const word = context.matchBefore(/\w*/)
  if (!word || (word.from === word.to && !context.explicit)) return null

  // Filter out keywords that exactly match the current word (case-insensitive)
  // This prevents the typed word from appearing as a suggestion
  const currentWord = context.state.sliceDoc(word.from, word.to).toUpperCase()
  const filteredOptions = boostedKeywords.filter(
    opt => opt.label.toUpperCase() !== currentWord
  )

  return { from: word.from, options: filteredOptions }
}

/**
 * Wraps a completion source to filter out completions that exactly match the typed word.
 * This prevents the autocomplete popup from showing when the user has already typed
 * the complete word, allowing Tab to work normally.
 */
export function filterExactMatches(source: CompletionSource): CompletionSource {
  return async (context: CompletionContext) => {
    const result = await source(context)
    if (!result) return null

    const word = context.matchBefore(/\w*/)
    if (!word) return result

    const typedWord = context.state.sliceDoc(word.from, word.to).toLowerCase()
    if (!typedWord) return result

    // Filter out options that exactly match the typed word
    const filteredOptions = result.options.filter(
      opt => opt.label.toLowerCase() !== typedWord
    )

    // If no options left after filtering, return null to hide autocomplete
    if (filteredOptions.length === 0) return null

    return { ...result, options: filteredOptions }
  }
}

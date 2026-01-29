import type { CompletionContext, CompletionSource } from '@codemirror/autocomplete'
import { getDialectCompletions, type SqlDialect } from './sqlDialects'

/**
 * Creates a completion source that provides boosted SQL keywords for a specific dialect.
 * This ensures common keywords appear at the top of the completion list.
 * @param dialect - The SQL dialect to get completions for (defaults to 'duckdb')
 */
export function boostedSqlKeywords(dialect: SqlDialect = 'duckdb') {
  const keywords = getDialectCompletions(dialect)

  return (context: CompletionContext) => {
    const word = context.matchBefore(/\w*/)
    if (!word || (word.from === word.to && !context.explicit)) return null

    // Filter out keywords that exactly match the current word (case-insensitive)
    // This prevents the typed word from appearing as a suggestion
    const currentWord = context.state.sliceDoc(word.from, word.to).toUpperCase()
    const filteredOptions = keywords.filter(
      opt => opt.label.toUpperCase() !== currentWord
    )

    return { from: word.from, options: filteredOptions }
  }
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

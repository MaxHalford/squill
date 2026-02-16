import type { Completion, CompletionContext, CompletionSource } from '@codemirror/autocomplete'
import { getDialectCompletions, type SqlDialect } from './sqlDialects'
import type { SchemaNamespace } from './schemaBuilder'

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
 * Schema completion source with substring matching.
 * Unlike CodeMirror's built-in schemaCompletionSource (prefix-only),
 * typing "orders" will suggest "customer_orders", "orders_detail", etc.
 *
 * Dot-path navigation still works: typing "dataset." shows tables in that dataset.
 * The substring matching applies to the component after the last dot.
 */
export function substringSchemaCompletions(schema: SchemaNamespace): CompletionSource {
  return (context: CompletionContext) => {
    // Match qualified identifiers: word chars, dots, hyphens (BQ project names)
    const word = context.matchBefore(/[\w\-.]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    const typed = context.state.sliceDoc(word.from, word.to);
    const parts = typed.split('.');
    const prefix = parts.slice(0, -1);
    const query = parts[parts.length - 1].toLowerCase();

    // Navigate schema hierarchy using the prefix parts
    // e.g. "my-project.my_dataset." → navigate to the dataset level
    let current: SchemaNamespace | string[] = schema;
    for (const part of prefix) {
      if (Array.isArray(current)) return null;
      const key = Object.keys(current).find(k => k.toLowerCase() === part.toLowerCase());
      if (!key) return null;
      const next: string[] | SchemaNamespace = current[key] as string[] | SchemaNamespace;
      if (Array.isArray(next)) {
        current = next;
        break;
      } else if (typeof next === 'object') {
        current = next;
      } else {
        return null;
      }
    }

    // `from` is the position after the last dot (where the current component starts)
    const lastDotIdx = typed.lastIndexOf('.');
    const from = lastDotIdx >= 0 ? word.from + lastDotIdx + 1 : word.from;

    let options: Completion[];

    if (Array.isArray(current)) {
      // Column level
      options = current
        .filter(col => !query || col.toLowerCase().includes(query))
        .filter(col => col.toLowerCase() !== query)
        .map(col => ({ label: col, type: 'property' }));
    } else {
      // Namespace level (projects, datasets, tables)
      options = Object.keys(current)
        .filter(key => !query || key.toLowerCase().includes(query))
        .filter(key => key.toLowerCase() !== query)
        .map(key => ({
          label: key,
          type: Array.isArray(current[key]) ? 'property' : 'class',
        }));
    }

    if (options.length === 0) return null;

    // Sort: prefix matches first, then substring matches, alphabetical within
    if (query) {
      options.sort((a, b) => {
        const aPrefix = a.label.toLowerCase().startsWith(query) ? 0 : 1;
        const bPrefix = b.label.toLowerCase().startsWith(query) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        return a.label.localeCompare(b.label);
      });
    }

    // filter: false — we handle filtering ourselves, skip CodeMirror's prefix filter
    return { from, options, filter: false };
  };
}

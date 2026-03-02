import type { Completion, CompletionContext, CompletionSource } from '@codemirror/autocomplete'
import { getDialectCompletions, type SqlDialect } from './sqlDialects'
import { extractAliases, extractCurrentStatement } from './queryAnalyzer'
import type { SchemaNamespace } from './schemaBuilder'

const MAX_COMPLETIONS = 50

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
 *
 * Also resolves table aliases: typing "u." when "FROM users u" is present
 * will suggest columns from the "users" table.
 */
export function substringSchemaCompletions(schema: SchemaNamespace): CompletionSource {
  // Memoize alias extraction — only re-parse when the statement text changes
  let cachedStatement = ''
  let cachedAliases: Map<string, string> = new Map()

  return (context: CompletionContext) => {
    // Match qualified identifiers: word chars, dots, hyphens (BQ project names)
    const word = context.matchBefore(/[\w\-.]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    const typed = context.state.sliceDoc(word.from, word.to);
    const parts = typed.split('.');
    let prefix = parts.slice(0, -1);
    const query = parts[parts.length - 1].toLowerCase();

    // Extract aliases scoped to the current statement (avoids cross-statement leaks)
    let aliases: Map<string, string> | null = null;
    if (!Array.isArray(schema)) {
      const statement = extractCurrentStatement(context.state.doc.toString(), context.pos);
      if (statement !== cachedStatement) {
        cachedStatement = statement;
        cachedAliases = extractAliases(statement);
      }
      aliases = cachedAliases;
    }

    // Resolve table aliases: if the first prefix part isn't a schema key,
    // check if it's an alias (e.g., "u" in "FROM users u") and resolve to the actual table
    if (prefix.length > 0 && aliases) {
      const firstPart = prefix[0].toLowerCase();
      const schemaHasKey = Object.keys(schema).some(k => k.toLowerCase() === firstPart);
      if (!schemaHasKey) {
        const resolved = aliases.get(firstPart);
        if (resolved) {
          prefix = [...resolved.split('.'), ...prefix.slice(1)];
        }
      }
    }

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
      } else if (next && typeof next === 'object') {
        current = next;
      } else {
        return null;
      }
    }

    // `from` is the position after the last dot (where the current component starts)
    const lastDotIdx = typed.lastIndexOf('.');
    const from = lastDotIdx >= 0 ? word.from + lastDotIdx + 1 : word.from;

    // Build options with match indices for highlighting
    interface MatchedCompletion extends Completion { matchIdx: number }
    let options: MatchedCompletion[];

    if (Array.isArray(current)) {
      // Column level — exclude exact matches (nothing to complete)
      options = [];
      for (const col of current) {
        const lc = col.toLowerCase();
        if (lc === query) continue;
        const idx = query ? lc.indexOf(query) : 0;
        if (query && idx < 0) continue;
        options.push({ label: col, type: 'property', matchIdx: idx });
      }
    } else {
      // Namespace level (projects, datasets, tables)
      // Keep exact matches — user may want to append a dot to navigate deeper
      options = [];
      for (const key of Object.keys(current)) {
        const lc = key.toLowerCase();
        const idx = query ? lc.indexOf(query) : 0;
        if (query && idx < 0) continue;
        options.push({
          label: key,
          type: Array.isArray(current[key]) ? 'property' : 'class',
          matchIdx: idx,
        });
      }

      // At top level (no dot prefix), add alias names as completions
      if (prefix.length === 0 && aliases) {
        for (const [alias, table] of aliases) {
          const idx = query ? alias.indexOf(query) : 0;
          if (query && idx < 0) continue;
          options.push({ label: alias, type: 'constant', detail: table, matchIdx: idx });
        }
      }
    }

    if (options.length === 0) return null;

    // Sort: prefix matches first, then substring matches, alphabetical within
    options.sort((a, b) => {
      if (query) {
        const aPrefix = a.matchIdx === 0 ? 0 : 1;
        const bPrefix = b.matchIdx === 0 ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      }
      return a.label.localeCompare(b.label);
    });

    // Cap results to avoid UI freezes on massive schemas
    if (options.length > MAX_COMPLETIONS) options.length = MAX_COMPLETIONS;

    // filter: false — we handle filtering ourselves, skip CodeMirror's prefix filter
    // getMatch — highlight the matched substring using pre-computed indices
    return {
      from,
      options,
      filter: false,
      getMatch: (completion: Completion) => {
        if (!query) return [];
        const mc = completion as MatchedCompletion;
        if (mc.matchIdx < 0) return [];
        return [mc.matchIdx, mc.matchIdx + query.length];
      }
    };
  };
}

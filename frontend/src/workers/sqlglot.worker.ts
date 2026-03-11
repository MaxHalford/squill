// Web Worker for SQLGlot validation and formatting via Pyodide WASM.
// Runs Python in the browser without blocking the main thread.

/* eslint-disable no-restricted-globals */
declare function importScripts(...urls: string[]): void
declare function loadPyodide(config?: Record<string, unknown>): Promise<PyodideInterface>

interface PyodideInterface {
  loadPackage: (name: string) => Promise<void>
  runPython: (code: string) => unknown
  globals: {
    get: (name: string) => (...args: string[]) => string
  }
}

interface WorkerRequest {
  id: number
  type: 'init' | 'validate' | 'format'
  query?: string
  dialect?: string
}

interface WorkerResponse {
  id: number
  type: 'ready' | 'validate-result' | 'format-result' | 'error'
  errors?: SqlGlotError[]
  formatted?: string
  message?: string
}

export interface SqlGlotError {
  message: string
  line: number
  col: number
  highlight: string
}

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/'

let pyodide: PyodideInterface | null = null

const PYTHON_CODE = `
import json
import sqlglot
from sqlglot.errors import ErrorLevel, ParseError

import re

def _clean_message(msg):
    """Simplify internal repr in error messages for readability."""
    # <Token ... text: WHERE ...> -> WHERE
    msg = re.sub(r"<Token[^>]*text:\\s*([^,>]+)[^>]*>", lambda m: m.group(1).strip(), msg)
    # <class 'sqlglot.expressions.Where'> -> Where
    msg = re.sub(r"<class\\s+'[^']*\\.([^']+)'>", r"\\1", msg)
    return msg

def validate_sql(query, dialect="duckdb"):
    # Keywords that are universally valid and should never be flagged as errors
    FALSE_POSITIVE_KEYWORDS = {"AS", "BY", "ON"}

    errors = []
    try:
        sqlglot.parse(query, read=dialect, error_level=ErrorLevel.RAISE)
    except ParseError as e:
        for err in e.errors:
            highlight = err.get("highlight", "").strip().upper()
            if highlight in FALSE_POSITIVE_KEYWORDS:
                continue
            msg = err.get("description", str(e))
            errors.append({
                "message": _clean_message(msg),
                "line": err.get("line", 1),
                "col": err.get("col", 0),
                "highlight": err.get("highlight", ""),
            })
        if not errors:
            return json.dumps([])
        return json.dumps(errors)
    except Exception as e:
        return json.dumps([{"message": str(e), "line": 1, "col": 0, "highlight": ""}])

    return json.dumps(errors)

def format_sql(query, dialect="duckdb"):
    try:
        statements = sqlglot.transpile(query, read=dialect, write=dialect, pretty=True)
        return ";\\n\\n".join(statements) + ";" if statements else query
    except Exception:
        return query
`

async function initPyodide(): Promise<void> {
  // Load Pyodide script
  importScripts(`${PYODIDE_CDN}pyodide.js`)
  pyodide = await loadPyodide({ indexURL: PYODIDE_CDN })
  await pyodide!.loadPackage('micropip')
  const micropip = pyodide!.runPython('import micropip; micropip') as { install: (pkg: string) => Promise<void> }
  await micropip.install('sqlglot')
  pyodide!.runPython(PYTHON_CODE)
}

onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, type } = e.data

  try {
    if (type === 'init') {
      await initPyodide()
      postMessage({ id, type: 'ready' } satisfies WorkerResponse)
      return
    }

    if (!pyodide) {
      postMessage({ id, type: 'error', message: 'Pyodide not initialized' } satisfies WorkerResponse)
      return
    }

    if (type === 'validate') {
      const { query = '', dialect = 'duckdb' } = e.data
      const result = pyodide.globals.get('validate_sql')(query, dialect)
      const errors: SqlGlotError[] = JSON.parse(result)
      postMessage({ id, type: 'validate-result', errors } satisfies WorkerResponse)
    } else if (type === 'format') {
      const { query = '', dialect = 'duckdb' } = e.data
      const formatted = pyodide.globals.get('format_sql')(query, dialect)
      postMessage({ id, type: 'format-result', formatted } satisfies WorkerResponse)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    postMessage({ id, type: 'error', message } satisfies WorkerResponse)
  }
}

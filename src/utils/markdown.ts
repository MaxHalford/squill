import DOMPurify from 'dompurify'
import { marked } from 'marked'

/**
 * Render markdown to sanitized HTML, safe for use with v-html.
 * Uses DOMPurify to strip any XSS vectors from the marked output.
 */
export function renderMarkdown(content: string): string {
  return DOMPurify.sanitize(marked(content) as string)
}

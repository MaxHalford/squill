/**
 * Background-tab notifications for query completion.
 * - Tab title: always shown when tab is hidden (any query duration)
 * - Voice: only for long queries (>10s), controlled by setting
 */

const DEFAULT_TITLE = 'Squill | SQL editor'
let restoreHandler: (() => void) | null = null

/** Update the browser tab title while the tab is hidden; restore on focus. */
export function notifyTab(boxName: string, success: boolean): void {
  if (!document.hidden) return

  const icon = success ? '\u2713' : '\u2717'
  const status = success ? 'finished' : 'failed'
  document.title = `${icon} ${boxName} ${status}`

  // Only one listener at a time — latest result wins
  if (restoreHandler) {
    document.removeEventListener('visibilitychange', restoreHandler)
  }
  restoreHandler = () => {
    if (!document.hidden) {
      document.title = DEFAULT_TITLE
      document.removeEventListener('visibilitychange', restoreHandler!)
      restoreHandler = null
    }
  }
  document.addEventListener('visibilitychange', restoreHandler)
}

/** Speak the query result via SpeechSynthesis. */
export function announceQueryResult(boxName: string, success: boolean): void {
  if (!document.hidden) return
  if (typeof speechSynthesis === 'undefined') return

  const status = success ? 'finished' : 'failed'
  const utterance = new SpeechSynthesisUtterance(`${boxName} ${status}`)
  utterance.rate = 1.1
  speechSynthesis.speak(utterance)
}

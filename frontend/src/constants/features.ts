// Master toggle for premium-tier UI: Pro plan, Desktop download, MCP server,
// and the sign-in / account flow (which today only buys Pro features).
// Set VITE_SHOW_PREMIUM=true to surface them; defaults to off for the public
// launch. Granular flags can be split out later if needed.
export const SHOW_PREMIUM: boolean = import.meta.env.VITE_SHOW_PREMIUM === 'true'

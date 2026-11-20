/** Plugin-owned route, separate from any host provider named Jev. */
export const JEV_PROVIDER = 'gomoku-jev'
export const JEV_MODEL = 'jev-latest'

/** Reject empty keys and characters that cannot be sent in an HTTP header. */
export function isValidJevApiKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{1,4096}$/.test(value.trim())
}

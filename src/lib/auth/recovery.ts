/**
 * Shared by /auth/callback (which sets the cookie) and the updatePassword
 * action (which requires and then clears it). Kept out of both so neither has
 * to import the other — a Server Action importing a Route Handler module would
 * drag the handler's exports into the action's module graph.
 */
export const RECOVERY_COOKIE = 'lr-recovery'
export const RECOVERY_PATH = '/auth/reset-password'

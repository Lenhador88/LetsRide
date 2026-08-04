import { z } from 'zod'

/**
 * A rider id arriving from a button on a rendered row. The database is the real
 * boundary — the foreign key and 009's `blocks_no_self_block` check both refuse
 * bad input — but parsing here turns "22P02 invalid input syntax for type uuid"
 * into a sentence, and costs one line.
 */
export const riderIdSchema = z.uuid('That rider could not be found.')

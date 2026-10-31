/** Raw UTF-8 limit; JSON envelope may escape characters and needs a larger transport limit. */
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
export const MAX_IMPORT_EVENTS = 50000;

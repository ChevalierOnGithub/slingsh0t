/** Where the database and install token live; one place so every entry point agrees. */
export const dataDir = (): string => process.env.SLINGSH0T_DATA_DIR || 'data'

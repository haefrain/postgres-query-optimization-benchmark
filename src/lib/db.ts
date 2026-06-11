import pg from 'pg';

export type DbClient = pg.Client;

/** Opens a single connection, runs `fn`, and always closes it. */
export async function withClient<T>(
  databaseUrl: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

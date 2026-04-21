export async function getConfig(db, key) {
  const row = await db
    .prepare('SELECT value FROM admin_config WHERE key = ?')
    .bind(key)
    .first();
  return row?.value ?? null;
}

export async function setConfig(db, key, value) {
  await db
    .prepare(
      `INSERT INTO admin_config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .bind(key, value)
    .run();
}

export async function getAllConfig(db) {
  const { results } = await db
    .prepare('SELECT key, value FROM admin_config')
    .all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

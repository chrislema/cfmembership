import { env } from 'cloudflare:test';
import schemaSql from '../../schema.sql?raw';

let schemaApplied = false;

export async function applySchema() {
  if (schemaApplied) return;
  const statements = schemaSql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
  schemaApplied = true;
}

export async function resetDb() {
  const tables = [
    'access_rule_plans',
    'access_rules',
    'memberships',
    'payments',
    'members',
    'plans',
    'admin_config',
  ];
  for (const t of tables) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

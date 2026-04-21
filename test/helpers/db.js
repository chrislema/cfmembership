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

export async function insertMember(id, email = `m${id}@test.local`) {
  await env.DB.prepare(
    `INSERT INTO members (id, email, created_at, status) VALUES (?, ?, ?, 'active')`
  )
    .bind(id, email, Date.now())
    .run();
}

export async function insertPlan(id, overrides = {}) {
  const {
    name = `Plan ${id}`,
    price_cents = 1000,
    interval = 'month',
    redirect_url = `/join/${id}`,
    sort_order = 0,
    active = 1,
  } = overrides;
  await env.DB.prepare(
    `INSERT INTO plans (id, name, price_cents, interval, redirect_url, sort_order, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, name, price_cents, interval, redirect_url, sort_order, active)
    .run();
}

export async function insertMembership(memberId, planId, status = 'active') {
  await env.DB.prepare(
    `INSERT INTO memberships (member_id, plan_id, status, source) VALUES (?, ?, ?, 'paid')`
  )
    .bind(memberId, planId, status)
    .run();
}

export async function insertRule(
  id,
  url_pattern,
  pattern_type,
  { sort_order = 0, plan_ids = [] } = {}
) {
  await env.DB.prepare(
    `INSERT INTO access_rules (id, url_pattern, pattern_type, sort_order) VALUES (?, ?, ?, ?)`
  )
    .bind(id, url_pattern, pattern_type, sort_order)
    .run();
  for (const pid of plan_ids) {
    await env.DB.prepare(
      `INSERT INTO access_rule_plans (rule_id, plan_id) VALUES (?, ?)`
    )
      .bind(id, pid)
      .run();
  }
}

export function normalizePath(path) {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

export function normalizePattern(pattern) {
  if (pattern.endsWith('/*')) {
    pattern = pattern.slice(0, -2) || '/';
  }
  return normalizePath(pattern);
}

export function ruleMatches(rule, path) {
  const base = normalizePattern(rule.url_pattern);
  const p = normalizePath(path);
  if (rule.pattern_type === 'exact') {
    return p === base;
  }
  if (rule.pattern_type === 'prefix') {
    if (base === '/') return true;
    return p === base || p.startsWith(base + '/');
  }
  return false;
}

function specificityScore(rule) {
  const base = normalizePattern(rule.url_pattern);
  return {
    type: rule.pattern_type === 'exact' ? 2 : 1,
    len: base.length,
  };
}

function isMoreSpecific(a, b) {
  const sa = specificityScore(a);
  const sb = specificityScore(b);
  if (sa.type !== sb.type) return sa.type > sb.type;
  if (sa.len !== sb.len) return sa.len > sb.len;
  return (a.sort_order ?? 0) < (b.sort_order ?? 0);
}

export function selectRule(rules, path) {
  let winner = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, path)) continue;
    if (!winner || isMoreSpecific(rule, winner)) winner = rule;
  }
  return winner;
}

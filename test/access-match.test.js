import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  normalizePattern,
  ruleMatches,
  selectRule,
} from '../src/access/match.js';

describe('normalizePath', () => {
  it('strips a trailing slash', () => {
    expect(normalizePath('/members/')).toBe('/members');
  });
  it('preserves the root slash', () => {
    expect(normalizePath('/')).toBe('/');
  });
  it('leaves paths without a trailing slash alone', () => {
    expect(normalizePath('/about')).toBe('/about');
  });
});

describe('normalizePattern', () => {
  it('strips a trailing /*', () => {
    expect(normalizePattern('/members/*')).toBe('/members');
  });
  it('treats /* at the root as /', () => {
    expect(normalizePattern('/*')).toBe('/');
  });
  it('strips a trailing slash', () => {
    expect(normalizePattern('/members/')).toBe('/members');
  });
});

describe('ruleMatches — exact', () => {
  const rule = { url_pattern: '/about', pattern_type: 'exact' };

  it('matches the exact path', () => {
    expect(ruleMatches(rule, '/about')).toBe(true);
  });
  it('matches even if the request has a trailing slash', () => {
    expect(ruleMatches(rule, '/about/')).toBe(true);
  });
  it('does not match a deeper path', () => {
    expect(ruleMatches(rule, '/about/us')).toBe(false);
  });
  it('does not match a sibling with the same starting name', () => {
    expect(ruleMatches(rule, '/aboutus')).toBe(false);
  });
});

describe('ruleMatches — prefix', () => {
  const rule = { url_pattern: '/members', pattern_type: 'prefix' };

  it('matches the base path', () => {
    expect(ruleMatches(rule, '/members')).toBe(true);
  });
  it('matches a direct child', () => {
    expect(ruleMatches(rule, '/members/post-1')).toBe(true);
  });
  it('matches a deeply nested child', () => {
    expect(ruleMatches(rule, '/members/a/b/c')).toBe(true);
  });
  it('does not match a sibling with the same starting name', () => {
    expect(ruleMatches(rule, '/membersonly')).toBe(false);
  });
  it('accepts patterns authored with a trailing /*', () => {
    const starred = { url_pattern: '/members/*', pattern_type: 'prefix' };
    expect(ruleMatches(starred, '/members/post-1')).toBe(true);
    expect(ruleMatches(starred, '/members')).toBe(true);
  });
  it('a root prefix matches everything', () => {
    const root = { url_pattern: '/*', pattern_type: 'prefix' };
    expect(ruleMatches(root, '/')).toBe(true);
    expect(ruleMatches(root, '/anything')).toBe(true);
    expect(ruleMatches(root, '/deep/nested/path')).toBe(true);
  });
});

describe('selectRule', () => {
  const rules = [
    { id: 1, url_pattern: '/members', pattern_type: 'prefix', sort_order: 0 },
    { id: 2, url_pattern: '/members/premium', pattern_type: 'prefix', sort_order: 0 },
    { id: 3, url_pattern: '/members/free-post', pattern_type: 'exact', sort_order: 0 },
  ];

  it('returns null when no rule matches', () => {
    expect(selectRule(rules, '/about')).toBe(null);
  });

  it('returns the one matching rule when only one applies', () => {
    expect(selectRule(rules, '/members/post-1').id).toBe(1);
  });

  it('longer prefix beats shorter prefix', () => {
    expect(selectRule(rules, '/members/premium/deep').id).toBe(2);
  });

  it('exact beats prefix at the same path', () => {
    expect(selectRule(rules, '/members/free-post').id).toBe(3);
  });

  it('normalizes a trailing slash on the request path', () => {
    expect(selectRule(rules, '/members/post-1/').id).toBe(1);
  });

  it('lower sort_order wins when specificity is tied', () => {
    const tied = [
      { id: 10, url_pattern: '/x', pattern_type: 'exact', sort_order: 5 },
      { id: 11, url_pattern: '/x', pattern_type: 'exact', sort_order: 1 },
    ];
    expect(selectRule(tied, '/x').id).toBe(11);
  });

  it('ignores rule order when computing specificity', () => {
    const shuffled = [...rules].reverse();
    expect(selectRule(shuffled, '/members/premium/x').id).toBe(2);
    expect(selectRule(shuffled, '/members/free-post').id).toBe(3);
  });
});

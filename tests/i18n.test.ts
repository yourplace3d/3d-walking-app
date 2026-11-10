import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MESSAGES, pickLang } from '../src/i18n';
import { en } from '../src/i18n/en';

describe('languages', () => {
  it('has every text in every language', () => {
    for (const m of Object.values(MESSAGES)) expect(Object.keys(m).sort()).toEqual(Object.keys(en).sort());
  });
  it('follows the browser, else English', () => {
    expect(pickLang(null, ['de-AT', 'en'])).toBe('de');
    expect(pickLang(null, ['fr'])).toBe('en');
    expect(pickLang('pt', ['de'])).toBe('pt');
  });
  it('knows every key the page uses', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url).pathname, 'utf8');
    const keys = [...html.matchAll(/data-t="([^"]+)"/g)].map((m) => m[1]);
    for (const a of html.matchAll(/data-t-attr="([^"]+)"/g)) for (const pair of a[1].split(';')) keys.push(pair.split(':')[1]);
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect(typeof (en as Record<string, unknown>)[k], k).toBe('string');
  });
});

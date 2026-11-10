/**
 * The app's language: English, Spanish, Portuguese (Brazil) or German. It follows the browser unless
 * the walker picked one, which is remembered on this device.
 *
 * The page's HTML is in English; elements carry their dictionary key in data-t (text) or
 * data-t-attr ("attribute:key;…"), and translatePage swaps them in. Everything the script writes
 * comes from `t`.
 */

import { de } from './de';
import { en, type Messages } from './en';
import { es } from './es';
import { pt } from './pt';

export type Lang = 'en' | 'es' | 'pt' | 'de';

export const LANGS: ReadonlyArray<{ code: Lang; name: string; locale: string }> = [
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'es', name: 'Español', locale: 'es-MX' },
  { code: 'pt', name: 'Português', locale: 'pt-BR' },
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
];

export const MESSAGES: Record<Lang, Messages> = { en, es, pt, de };

const KEY = 'walkit:lang';

export function pickLang(chosen: string | null, preferred: readonly string[]): Lang {
  if (chosen && chosen in MESSAGES) return chosen as Lang;
  for (const p of preferred) {
    const code = p.slice(0, 2).toLowerCase();
    if (code in MESSAGES) return code as Lang;
  }
  return 'en';
}

function chosenLang(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const lang: Lang =
  typeof navigator === 'undefined' ? 'en' : pickLang(chosenLang(), navigator.languages?.length ? navigator.languages : [navigator.language ?? 'en']);
export const t: Messages = MESSAGES[lang];
export const locale = LANGS.find((l) => l.code === lang)!.locale;

export function saveLang(code: Lang): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* private browsing: the choice lasts for this page only */
  }
}

const formats = new Map<number, Intl.NumberFormat>();

/** A number as this language writes it. */
export function num(x: number, digits = 0): string {
  let f = formats.get(digits);
  if (!f) {
    f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formats.set(digits, f);
  }
  return f.format(x);
}

/** "350 m", "1.9 km", "12 km" */
export function distance(m: number): string {
  return m < 1000 ? `${num(Math.round(m / 10) * 10)} m` : `${num(m / 1000, m < 9950 ? 1 : 0)} km`;
}

/** An area: "8,500 m²", "0.12 km²" */
export function areaText(m2: number): string {
  return m2 < 100_000 ? `${num(Math.round(m2 / 100) * 100)} m²` : `${num(m2 / 1e6, 2)} km²`;
}

/** "0:05", "1:24:09" from milliseconds */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (x: number) => String(x).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** "12 MB" */
export function bytes(b: number): string {
  return b < 1e6 ? `${num(Math.max(1, Math.round(b / 1e3)))} kB` : `${num(b / 1e6, b < 1e7 ? 1 : 0)} MB`;
}

export function lookup(key: string, messages: Messages = t): unknown {
  return (messages as Record<string, unknown>)[key];
}

/** Put this language's texts into the page, and fill the language pickers. */
export function translatePage(root: Document = document): void {
  root.documentElement.lang = locale;
  root.title = t.docTitle;
  for (const el of root.querySelectorAll<HTMLElement>('[data-t]')) {
    const v = lookup(el.dataset.t!);
    if (typeof v === 'string') el.textContent = v;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-t-attr]')) {
    for (const pair of el.dataset.tAttr!.split(';')) {
      const [attr, key] = pair.split(':');
      const v = lookup(key);
      if (typeof v === 'string') el.setAttribute(attr, v);
    }
  }
  for (const select of root.querySelectorAll<HTMLSelectElement>('.lang-select')) {
    select.replaceChildren(
      ...LANGS.map((l) => {
        const o = root.createElement('option');
        o.value = l.code;
        o.textContent = l.name;
        o.lang = l.locale;
        o.selected = l.code === lang;
        return o;
      }),
    );
    select.addEventListener('change', () => {
      saveLang(select.value as Lang);
      location.reload();
    });
  }
}

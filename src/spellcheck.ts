import nspell from 'nspell';
import aff from '../node_modules/dictionary-en/index.aff?raw';
import dic from '../node_modules/dictionary-en/index.dic?raw';

export interface Misspelling { start: number; length: number; word: string }

export const screenplayDictionaryWords = [
  // Scene-heading and location shorthand.
  'INT', 'EXT', 'EST', 'INT/EXT', 'EXT/INT', 'I/E',
  // Dialogue extensions and pagination cues.
  "CONT'D", 'CONT’D', 'MORE', 'V.O.', 'V/O', 'O.S.', 'O/S', 'O.C.', 'O/C',
  // Common production and shot shorthand.
  'SFX', 'VFX', 'FX', 'MOS', 'POV', 'BG', 'FG', 'CU', 'ECU', 'OTS',
  // Common screenplay structural terms that may appear as standalone cues.
  'INTERCUT', 'FLASHBACK', 'FLASHFORWARD', 'MONTAGE', 'SERIES', 'SUPER',
] as const;
const screenplayWords = new Set(screenplayDictionaryWords.map((word) => normalizeDictionaryWord(word)));
const wordPattern = /[\p{L}][\p{L}\p{M}'’.-]*/gu;
export type SpellEngine = ReturnType<typeof nspell>;
let checker: SpellEngine | null = null;

export function normalizeDictionaryWord(word: string): string {
  return word.trim().replace(/[’]/g, "'").replace(/\./g, '').replace(/^["“”'.-]+|["“”'.-]+$/g, '').toLocaleLowerCase();
}

export function spellchecker(): SpellEngine {
  if (!checker) checker = nspell(aff, dic);
  return checker;
}

export function findMisspellings(text: string, customWords: Iterable<string>, engine: Pick<SpellEngine, 'correct'> = spellchecker()): Misspelling[] {
  const custom = new Set([...customWords].map(normalizeDictionaryWord).filter(Boolean));
  const correctness = new Map<string, boolean>();
  const misses: Misspelling[] = [];
  for (const match of text.matchAll(wordPattern)) {
    const raw = match[0];
    const word = raw.replace(/^['’.-]+|['’.-]+$/g, '');
    if (!word || word.length === 1 || match.index === undefined) continue;
    const normalized = normalizeDictionaryWord(word);
    let correct = custom.has(normalized) || screenplayWords.has(normalized);
    if (!correct) {
      const cached = correctness.get(normalized);
      correct = cached ?? (engine.correct(word) || engine.correct(normalized));
      correctness.set(normalized, correct);
    }
    if (!correct) misses.push({ start: match.index + raw.indexOf(word), length: word.length, word });
  }
  return misses;
}

export function wordAt(text: string, offset: number): Misspelling | null {
  for (const match of text.matchAll(wordPattern)) {
    if (match.index === undefined) continue;
    const end = match.index + match[0].length;
    if (offset >= match.index && offset <= end) return { start: match.index, length: match[0].length, word: match[0] };
    if (match.index > offset) break;
  }
  return null;
}

export function spellingSuggestions(word: string, limit = 5): string[] {
  return spellchecker().suggest(word).filter((suggestion) => suggestion.toLocaleLowerCase() !== word.toLocaleLowerCase()).slice(0, limit);
}

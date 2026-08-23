import { describe, expect, it } from 'vitest';
import { findMisspellings, normalizeDictionaryWord, screenplayDictionaryWords, spellchecker, wordAt } from './spellcheck';

const engine = { correct: (word: string) => ['this', 'is', 'correct', 'nash', 'meets'].includes(word.toLowerCase()) };

describe('screenplay spell checking', () => {
  it('returns exact ranges for unknown words', () => {
    expect(findMisspellings('This is mizpeled.', [], engine)).toEqual([{ start: 8, length: 8, word: 'mizpeled' }]);
  });

  it('accepts screenplay-specific custom words case-insensitively', () => {
    expect(findMisspellings('NASH meets Quuxley.', ['Quuxley'], engine)).toEqual([]);
  });

  it('finds the word beneath a caret offset', () => {
    expect(wordAt('Hello unusual-name here', 10)).toEqual({ start: 6, length: 12, word: 'unusual-name' });
  });

  it('normalizes personal dictionary entries', () => {
    expect(normalizeDictionaryWord('  “Quuxley.” ')).toBe('quuxley');
  });

  it('loads the bundled English dictionary', () => {
    expect(spellchecker().correct('screenplay')).toBe(true);
    expect(spellchecker().correct('mizpeled')).toBe(false);
  });

  it('accepts expected Fountain and screenplay shorthand', () => {
    const text = `INT. HOUSE - NIGHT\n\nMARA (V.O.)\nHello.\n\nMARA (CONT'D)\nGo!\n\nINTERCUT WITH:`;
    const misses = findMisspellings(text, [], { correct: (word) => ['house', 'night', 'mara', 'hello', 'go', 'with'].includes(normalizeDictionaryWord(word)) });
    expect(misses).toEqual([]);
    expect(screenplayDictionaryWords).toContain('V.O.');
    expect(screenplayDictionaryWords).toContain("CONT'D");
  });

  it('normalizes dotted abbreviations and typographic continuation marks', () => {
    expect(normalizeDictionaryWord('V.O.')).toBe('vo');
    expect(normalizeDictionaryWord('CONT’D')).toBe("cont'd");
  });
});

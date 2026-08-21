import { describe, expect, it } from 'vitest';
import { parseFountain, printableText, stripInlineNotes, unescapeFountain } from './fountain';

describe('parseFountain', () => {
  it('extracts scenes, dialogue, characters, and corrections', () => {
    const parsed = parseFountain('Title: Test\n\nINT. ROOM - DAY\n\nMARA\nHello there.\n\nCUT TO');
    expect(parsed.sceneCount).toBe(1);
    expect(parsed.characters[0]).toMatchObject({ name: 'MARA', dialogueLines: 1, dialogueWords: 2, sceneCount: 1 });
    expect(parsed.diagnostics.some((item) => item.replacement === 'CUT TO:')).toBe(true);
  });

  it('supports forced Fountain 1.1 elements and dual dialogue', () => {
    const parsed = parseFountain('.MONTAGE\n\n@McCLANE\nWelcome to the party.\n\nHANS ^\n(quietly)\nNot yet.\n\n!THIS REMAINS ACTION\n\n>SMASH TO');
    expect(parsed.lines.find((line) => line.type === 'scene')).toMatchObject({ forced: true });
    expect(parsed.lines.find((line) => line.character === 'McCLANE')).toMatchObject({ type: 'character', forced: true });
    expect(parsed.lines.find((line) => line.character === 'HANS' && line.type === 'character')).toMatchObject({ dualDialogue: true });
    expect(parsed.lines.find((line) => line.text.includes('THIS REMAINS'))).toMatchObject({ type: 'action', forced: true });
    expect(parsed.lines.at(-1)).toMatchObject({ type: 'transition', forced: true });
  });

  it('parses multiline title metadata and excludes boneyards from analysis', () => {
    const parsed = parseFountain('Title:\n  The Long Night\nAuthor: Devon\nContact:\n  devon@example.com\n\nINT. ROOM - NIGHT\n\n/*\nMARA\nHidden words here.\n*/\n\nMARA\nVisible words.');
    expect(parsed.titlePage).toMatchObject({ title: 'The Long Night', author: 'Devon', contact: 'devon@example.com' });
    expect(parsed.lines.filter((line) => line.type === 'boneyard')).toHaveLength(4);
    expect(parsed.characters[0]).toMatchObject({ name: 'MARA', dialogueWords: 2 });
  });

  it('handles inline notes, escaped controls, lyrics, and unclosed blocks', () => {
    const parsed = parseFountain('INT. CLUB - NIGHT\n\nMARA\n~Sing it loud [[tempo note]]\n\n\\@this is action\n\n/* unfinished');
    expect(parsed.lines.find((line) => line.type === 'lyric')).toBeTruthy();
    expect(parsed.diagnostics.some((item) => item.message.includes('boneyard'))).toBe(true);
    expect(stripInlineNotes('Keep [[private]] this')).toBe('Keep  this');
    expect(unescapeFountain('\\*literal\\*')).toBe('*literal*');
    expect(printableText(parsed.lines.find((line) => line.type === 'lyric')!)).toBe('Sing it loud');
  });
});

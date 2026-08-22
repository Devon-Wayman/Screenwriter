import { describe, expect, it } from 'vitest';
import { parseFountain } from './fountain';
import { createScreenplayPdf, layoutScreenplay, parseInlineEmphasis } from './pdf';

const options = { paperSize: 'letter' as const, includeTitlePage: true, sceneNumbers: true };

describe('screenplay PDF layout', () => {
  it('creates a title page and numbered screenplay pages', () => {
    const document = parseFountain('Title: Test Picture\nCredit: Written by\nAuthor: Devon\n\nINT. ROOM - DAY\n\nMARA\nHello.');
    const layout = layoutScreenplay(document, options);
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0].number).toBeNull();
    expect(layout.pages[0].blocks.some((block) => block.type === 'title')).toBe(true);
    expect(layout.pages[1].number).toBe(1);
    expect(layout.pages[1].blocks.find((block) => block.type === 'scene')?.sceneNumber).toBe('1');
    expect(layout.pages[1].blocks.find((block) => block.type === 'scene')?.sourceStart).toBeGreaterThan(0);
  });

  it('lays dual dialogue out in separate columns', () => {
    const document = parseFountain('INT. ROOM - DAY\n\nMARA\nLeft side.\n\nJONAH ^\nRight side.');
    const layout = layoutScreenplay(document, { ...options, includeTitlePage: false });
    const characters = layout.pages[0].blocks.filter((block) => block.type === 'character');
    expect(characters).toHaveLength(2);
    expect(characters[0].x).toBeLessThan(characters[1].x);
  });

  it('honors explicit page breaks', () => {
    const document = parseFountain('INT. ONE - DAY\n\nAction.\n\n===\n\nEXT. TWO - NIGHT');
    expect(layoutScreenplay(document, { ...options, includeTitlePage: false }).pages).toHaveLength(2);
  });

  it('preserves inline emphasis as styled runs', () => {
    const runs = parseInlineEmphasis('Plain **bold** and _underlined_ plus *italic*.');
    expect(runs.some((run) => run.bold && run.text === 'bold')).toBe(true);
    expect(runs.some((run) => run.underline && run.text === 'underlined')).toBe(true);
    expect(runs.some((run) => run.italic && run.text === 'italic')).toBe(true);
    expect(parseInlineEmphasis('An escaped \\*asterisk\\*.').map((run) => run.text).join('')).toBe('An escaped *asterisk*.');
  });

  it('paginates a feature-length outline', () => {
    const script = Array.from({ length: 120 }, (_, index) => `INT. LOCATION ${index + 1} - DAY\n\nA full paragraph of action establishes the scene and moves the story forward.\n\nMARA\nThis dialogue belongs to scene ${index + 1}.`).join('\n\n');
    const layout = layoutScreenplay(parseFountain(script), { ...options, includeTitlePage: false });
    expect(layout.pages.length).toBeGreaterThan(15);
    expect(layout.pages.every((page) => page.blocks.every((block) => block.y < layout.height - 60))).toBe(true);
  });

  it('generates a non-empty PDF document', () => {
    const document = parseFountain('Title: PDF Test\n\nINT. ROOM - DAY #12A#\n\nMARA\nHello.');
    const bytes = createScreenplayPdf(document, options).output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(layoutScreenplay(document, options).pages[1].blocks.find((block) => block.type === 'scene')?.sceneNumber).toBe('12A');
  });

  it('appends selected scene layouts as landscape diagram pages', () => {
    const document = parseFountain('INT. ROOM - DAY\n\nMARA\nHello.');
    const layouts = [{ id: 'room', heading: 'INT. ROOM - DAY', sceneNumber: '1', order: 0, updatedAt: '2026-08-21T12:00:00.000Z', shapes: [{ id: 'table', type: 'rectangle' as const, x: 300, y: 240, width: 180, height: 90, label: 'Table', color: '#6f8f7c', rotation: 15 }] }];
    const pdf = createScreenplayPdf(document, { ...options, includeTitlePage: false }, layouts);

    expect(pdf.getNumberOfPages()).toBe(2);
    expect(pdf.getPageInfo(2).pageContext.mediaBox.topRightX).toBeGreaterThan(pdf.getPageInfo(2).pageContext.mediaBox.topRightY);
  });

  it('inserts character cards between the title page and screenplay', () => {
    const document = parseFountain('Title: Casting Test\nAuthor: Devon\n\nINT. ROOM - DAY\n\nMARA\nHello.');
    const cards = [{ name: 'MARA', age: '30s', casting: 'female' as const, traits: 'Resolute and observant', description: 'The central investigator.' }];
    const pdf = createScreenplayPdf(document, { ...options, includeCharacterCards: true }, [], cards);
    expect(pdf.getNumberOfPages()).toBe(3);
  });

  it('adds dialogue continuation markers when a speech crosses a page', () => {
    const speech = Array.from({ length: 900 }, () => 'word').join(' ');
    const layout = layoutScreenplay(parseFountain(`INT. ROOM - DAY\n\nMARA\n${speech}`), { ...options, includeTitlePage: false, automaticContinuations: true });
    const printed = layout.pages.flatMap((page) => page.blocks.flatMap((block) => block.lines.flatMap((line) => line.map((run) => run.text).join(''))));
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(printed).toContain('(MORE)');
    expect(printed.some((line) => line.includes("MARA (CONT'D)"))).toBe(true);
  });
});

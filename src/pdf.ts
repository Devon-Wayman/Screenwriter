import { jsPDF } from 'jspdf';
import { printableMarkup } from './fountain';
import type { FountainDocument, FountainLine } from './types';

export interface PdfOptions {
  paperSize: 'letter' | 'a4';
  includeTitlePage: boolean;
  sceneNumbers: boolean;
}

export interface StyledRun { text: string; bold: boolean; italic: boolean; underline: boolean }
export interface PdfBlock { x: number; y: number; width: number; align: 'left' | 'center' | 'right'; lines: StyledRun[][]; type: string; sceneNumber?: string }
export interface PdfPage { number: number | null; blocks: PdfBlock[] }
export interface PdfLayout { width: number; height: number; pages: PdfPage[] }

const FONT_SIZE = 12;
const LINE_HEIGHT = 12;
const CHAR_WIDTH = 7.2;

export function parseInlineEmphasis(value: string): StyledRun[] {
  const runs: StyledRun[] = [];
  let bold = false, italic = false, underline = false, buffer = '';
  const push = () => { if (buffer) { runs.push({ text: buffer, bold, italic, underline }); buffer = ''; } };
  for (let index = 0; index < value.length;) {
    if (value[index] === '\\' && index + 1 < value.length && /[*_\\]/.test(value[index + 1])) { buffer += value[index + 1]; index += 2; continue; }
    if (value.startsWith('***', index)) { push(); bold = !bold; italic = !italic; index += 3; continue; }
    if (value.startsWith('**', index)) { push(); bold = !bold; index += 2; continue; }
    if (value[index] === '*') { push(); italic = !italic; index++; continue; }
    if (value[index] === '_') { push(); underline = !underline; index++; continue; }
    buffer += value[index++];
  }
  push(); return runs;
}

function wrapRuns(runs: StyledRun[], width: number): StyledRun[][] {
  const maxCharacters = Math.max(1, Math.floor(width / CHAR_WIDTH));
  const tokens = runs.flatMap((run) => run.text.split(/(\s+)/).filter(Boolean).map((text) => ({ ...run, text })));
  const lines: StyledRun[][] = [[]];
  let count = 0;
  const append = (token: StyledRun) => {
    const line = lines[lines.length - 1]; const previous = line[line.length - 1];
    if (previous && previous.bold === token.bold && previous.italic === token.italic && previous.underline === token.underline) previous.text += token.text;
    else line.push({ ...token });
    count += token.text.length;
  };
  for (const token of tokens) {
    if (/^\s+$/.test(token.text) && count === 0) continue;
    if (count > 0 && count + token.text.length > maxCharacters) { lines.push([]); count = 0; if (/^\s+$/.test(token.text)) continue; }
    if (token.text.length > maxCharacters) {
      let remaining = token.text;
      while (remaining.length) {
        const available = maxCharacters - count;
        if (available === 0) { lines.push([]); count = 0; continue; }
        append({ ...token, text: remaining.slice(0, available) }); remaining = remaining.slice(available);
        if (remaining) { lines.push([]); count = 0; }
      }
    } else append(token);
  }
  return lines.length ? lines : [[{ text: '', bold: false, italic: false, underline: false }]];
}

type Element = { kind: 'line'; line: FountainLine } | { kind: 'dialogue'; lines: FountainLine[]; dual: boolean } | { kind: 'dual'; left: FountainLine[]; right: FountainLine[] } | { kind: 'break' };

function elements(document: FountainDocument): Element[] {
  const result: Element[] = [];
  for (let index = 0; index < document.lines.length;) {
    const line = document.lines[index];
    if (['title', 'empty', 'note', 'boneyard', 'section', 'synopsis'].includes(line.type)) { index++; continue; }
    if (line.type === 'page-break') { result.push({ kind: 'break' }); index++; continue; }
    if (line.type === 'character') {
      const dialogue = [line]; let cursor = index + 1;
      while (cursor < document.lines.length && ['parenthetical', 'dialogue', 'lyric'].includes(document.lines[cursor].type)) dialogue.push(document.lines[cursor++]);
      if (line.dualDialogue && result.at(-1)?.kind === 'dialogue') {
        const left = result.pop() as Extract<Element, { kind: 'dialogue' }>;
        result.push({ kind: 'dual', left: left.lines, right: dialogue });
      } else result.push({ kind: 'dialogue', lines: dialogue, dual: Boolean(line.dualDialogue) });
      index = cursor; continue;
    }
    result.push({ kind: 'line', line }); index++;
  }
  return result;
}

function plainRuns(line: FountainLine) { return parseInlineEmphasis(printableMarkup(line)); }

export function layoutScreenplay(document: FountainDocument, options: PdfOptions): PdfLayout {
  const width = options.paperSize === 'letter' ? 612 : 595.28;
  const height = options.paperSize === 'letter' ? 792 : 841.89;
  const top = 72, bottom = height - 72, left = 108, right = width - 72, bodyWidth = right - left;
  const pages: PdfPage[] = [];
  let scriptPage = 1, page!: PdfPage, y = top;
  const newPage = (number: number | null) => { page = { number, blocks: [] }; pages.push(page); y = top; };

  if (options.includeTitlePage && Object.keys(document.titlePage).length) {
    newPage(null);
    const title = document.titlePage.title || 'Untitled Screenplay';
    const credit = document.titlePage.credit || 'Written by';
    const author = document.titlePage.author || document.titlePage.authors || '';
    const source = document.titlePage.source || '';
    let titleY = height * .36;
    for (const value of [title, credit, author, source].filter(Boolean)) {
      const lines = wrapRuns(parseInlineEmphasis(value), bodyWidth);
      page.blocks.push({ x: left, y: titleY, width: bodyWidth, align: 'center', lines, type: 'title' });
      titleY += lines.length * LINE_HEIGHT + (value === title ? 24 : 8);
    }
    const contact = document.titlePage.contact;
    if (contact) page.blocks.push({ x: left, y: height - 120, width: bodyWidth / 2, align: 'left', lines: contact.split('\n').map((value) => parseInlineEmphasis(value)), type: 'contact' });
  }
  newPage(scriptPage++);

  const ensure = (needed: number) => { if (y + needed > bottom) newPage(scriptPage++); };
  const addBlock = (type: string, textRuns: StyledRun[], x: number, blockWidth: number, align: PdfBlock['align'], before = 0, sceneNumber?: string) => {
    const lines = wrapRuns(textRuns, blockWidth); ensure(before + lines.length * LINE_HEIGHT); y += before;
    page.blocks.push({ x, y, width: blockWidth, align, lines, type, sceneNumber }); y += lines.length * LINE_HEIGHT;
  };
  let sceneNumber = 0;

  for (const element of elements(document)) {
    if (element.kind === 'break') { if (page.blocks.length) newPage(scriptPage++); continue; }
    if (element.kind === 'line') {
      const line = element.line; const runs = plainRuns(line);
      if (line.type === 'scene') { sceneNumber++; ensure(36); addBlock('scene', runs, left, bodyWidth, 'left', page.blocks.length ? 12 : 0, options.sceneNumbers ? (line.sceneNumber || String(sceneNumber)) : undefined); }
      else if (line.type === 'transition') addBlock('transition', runs, left, bodyWidth, 'right', 12);
      else if (line.type === 'centered') addBlock('centered', runs, left, bodyWidth, 'center', 12);
      else addBlock(line.type, runs, left, bodyWidth, 'left', line.type === 'action' ? 12 : 0);
      continue;
    }
    if (element.kind === 'dialogue') {
      const measured = element.lines.reduce((sum, line) => sum + wrapRuns(plainRuns(line), line.type === 'dialogue' ? 252 : 180).length * LINE_HEIGHT, 12);
      ensure(measured); y += 12;
      for (const line of element.lines) {
        if (line.type === 'character') addBlock('character', plainRuns(line), 252, 252, 'left');
        else if (line.type === 'parenthetical') addBlock('parenthetical', plainRuns(line), 216, 180, 'left');
        else addBlock('dialogue', plainRuns(line), 180, 252, 'left');
      }
      continue;
    }
    const columnWidth = (bodyWidth - 36) / 2;
    const groupHeight = (lines: FountainLine[]) => lines.reduce((sum, line) => sum + wrapRuns(plainRuns(line), columnWidth - 24).length * LINE_HEIGHT, 0);
    const heightNeeded = Math.max(groupHeight(element.left), groupHeight(element.right)) + 12;
    ensure(heightNeeded); y += 12; const startY = y;
    const addColumn = (lines: FountainLine[], x: number) => {
      let columnY = startY;
      for (const line of lines) {
        const blockWidth = line.type === 'character' ? columnWidth : columnWidth - 24;
        const linesWrapped = wrapRuns(plainRuns(line), blockWidth);
        page.blocks.push({ x: line.type === 'character' ? x : x + 12, y: columnY, width: blockWidth, align: line.type === 'character' ? 'center' : 'left', lines: linesWrapped, type: line.type });
        columnY += linesWrapped.length * LINE_HEIGHT;
      }
    };
    addColumn(element.left, left); addColumn(element.right, left + columnWidth + 36); y += heightNeeded - 12;
  }
  return { width, height, pages };
}

function renderRunLine(pdf: jsPDF, runs: StyledRun[], x: number, y: number, width: number, align: PdfBlock['align']) {
  const total = runs.reduce((sum, run) => sum + pdf.getTextWidth(run.text), 0);
  let cursor = align === 'center' ? x + (width - total) / 2 : align === 'right' ? x + width - total : x;
  for (const run of runs) {
    const style = run.bold && run.italic ? 'bolditalic' : run.bold ? 'bold' : run.italic ? 'italic' : 'normal';
    pdf.setFont('courier', style); pdf.text(run.text, cursor, y);
    const runWidth = pdf.getTextWidth(run.text);
    if (run.underline) pdf.line(cursor, y + 1.5, cursor + runWidth, y + 1.5);
    cursor += runWidth;
  }
}

export function createScreenplayPdf(document: FountainDocument, options: PdfOptions) {
  const layout = layoutScreenplay(document, options);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: options.paperSize });
  pdf.setFont('courier', 'normal'); pdf.setFontSize(FONT_SIZE); pdf.setLineWidth(.5);
  layout.pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) pdf.addPage(options.paperSize, 'portrait');
    if (page.number !== null && page.number > 1) pdf.text(String(page.number), layout.width - 72, 42, { align: 'right' });
    for (const block of page.blocks) {
      block.lines.forEach((line, lineIndex) => renderRunLine(pdf, line, block.x, block.y + lineIndex * LINE_HEIGHT, block.width, block.align));
      if (block.sceneNumber) {
        const y = block.y; pdf.setFont('courier', 'normal');
        pdf.text(String(block.sceneNumber), 72, y); pdf.text(String(block.sceneNumber), layout.width - 54, y, { align: 'right' });
      }
    }
  });
  pdf.setProperties({ title: document.titlePage.title || 'Screenplay', author: document.titlePage.author || document.titlePage.authors || '', subject: 'Screenplay exported from Screenwriter' });
  return pdf;
}

export function downloadScreenplayPdf(document: FountainDocument, options: PdfOptions, fountainFilename: string) {
  const name = fountainFilename.replace(/\.(fountain|txt)$/i, '') || 'Screenplay';
  createScreenplayPdf(document, options).save(`${name}.pdf`);
}

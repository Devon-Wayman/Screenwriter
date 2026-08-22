import { jsPDF } from 'jspdf';
import { printableMarkup } from './fountain';
import type { CharacterCard, FountainDocument, FountainLine, StageSceneLayout, StageShape } from './types';

export interface PdfOptions {
  paperSize: 'letter' | 'a4';
  includeTitlePage: boolean;
  sceneNumbers: boolean;
  includeCharacterCards?: boolean;
  automaticContinuations?: boolean;
  headerText?: string;
  footerText?: string;
  watermark?: string;
  revisionColor?: string;
  revisionMarks?: boolean;
}

export interface StyledRun { text: string; bold: boolean; italic: boolean; underline: boolean }
export interface PdfBlock { x: number; y: number; width: number; align: 'left' | 'center' | 'right'; lines: StyledRun[][]; type: string; sceneNumber?: string; sourceStart?: number }
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
  const addBlock = (type: string, textRuns: StyledRun[], x: number, blockWidth: number, align: PdfBlock['align'], before = 0, sceneNumber?: string, sourceStart?: number) => {
    const lines = wrapRuns(textRuns, blockWidth); ensure(before + lines.length * LINE_HEIGHT); y += before;
    page.blocks.push({ x, y, width: blockWidth, align, lines, type, sceneNumber, sourceStart }); y += lines.length * LINE_HEIGHT;
  };
  let sceneNumber = 0;

  for (const element of elements(document)) {
    if (element.kind === 'break') { if (page.blocks.length) newPage(scriptPage++); continue; }
    if (element.kind === 'line') {
      const line = element.line; const runs = plainRuns(line);
      if (line.type === 'scene') { sceneNumber++; ensure(36); addBlock('scene', runs, left, bodyWidth, 'left', page.blocks.length ? 12 : 0, options.sceneNumbers ? (line.sceneNumber || String(sceneNumber)) : undefined, line.start); }
      else if (line.type === 'transition') addBlock('transition', runs, left, bodyWidth, 'right', 12, undefined, line.start);
      else if (line.type === 'centered') addBlock('centered', runs, left, bodyWidth, 'center', 12, undefined, line.start);
      else addBlock(line.type, runs, left, bodyWidth, 'left', line.type === 'action' ? 12 : 0, undefined, line.start);
      continue;
    }
    if (element.kind === 'dialogue') {
      const measured = element.lines.reduce((sum, line) => sum + wrapRuns(plainRuns(line), line.type === 'dialogue' ? 252 : 180).length * LINE_HEIGHT, 12);
      ensure(measured); y += 12;
      const characterName = printableMarkup(element.lines[0]).replace(/\s*\(CONT'D\)\s*$/i, '');
      for (const line of element.lines) {
        const x = line.type === 'character' ? 252 : line.type === 'parenthetical' ? 216 : 180;
        const blockWidth = line.type === 'dialogue' ? 252 : 180;
        const wrapped = wrapRuns(plainRuns(line), blockWidth); let offset = 0;
        while (offset < wrapped.length) {
          let available = Math.floor((bottom - y) / LINE_HEIGHT);
          if (available < 1) {
            if (options.automaticContinuations !== false) page.blocks.push({ x: 180, y: bottom - LINE_HEIGHT, width: 252, align: 'center', lines: [[{ text: '(MORE)', bold: false, italic: false, underline: false }]], type: 'more' });
            newPage(scriptPage++);
            if (options.automaticContinuations !== false && line.type !== 'character') { page.blocks.push({ x: 252, y, width: 252, align: 'left', lines: [[{ text: `${characterName} (CONT'D)`, bold: false, italic: false, underline: false }]], type: 'character' }); y += LINE_HEIGHT; }
            available = Math.floor((bottom - y) / LINE_HEIGHT);
          }
          const needsSplit = wrapped.length - offset > available;
          const take = needsSplit && options.automaticContinuations !== false ? Math.max(1, available - 1) : available;
          const part = wrapped.slice(offset, offset + take);
          page.blocks.push({ x, y, width: blockWidth, align: 'left', lines: part, type: line.type, sourceStart: line.start }); y += part.length * LINE_HEIGHT; offset += part.length;
          if (offset < wrapped.length) {
            if (options.automaticContinuations !== false) { page.blocks.push({ x: 180, y, width: 252, align: 'center', lines: [[{ text: '(MORE)', bold: false, italic: false, underline: false }]], type: 'more' }); }
            newPage(scriptPage++);
            if (options.automaticContinuations !== false && line.type !== 'character') { page.blocks.push({ x: 252, y, width: 252, align: 'left', lines: [[{ text: `${characterName} (CONT'D)`, bold: false, italic: false, underline: false }]], type: 'character' }); y += LINE_HEIGHT; }
          }
        }
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
        page.blocks.push({ x: line.type === 'character' ? x : x + 12, y: columnY, width: blockWidth, align: line.type === 'character' ? 'center' : 'left', lines: linesWrapped, type: line.type, sourceStart: line.start });
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

function appendCharacterCards(pdf: jsPDF, cards: CharacterCard[], options: PdfOptions, useCurrentPage = false) {
  const width = options.paperSize === 'letter' ? 612 : 595.28, height = options.paperSize === 'letter' ? 792 : 841.89;
  const margin = 64, bottom = height - 64, bodyWidth = width - margin * 2;
  if (!useCurrentPage) pdf.addPage(options.paperSize, 'portrait');
  let y = margin;
  const heading = () => { pdf.setTextColor(20, 20, 20); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.text('CHARACTERS', margin, y); y += 30; };
  heading();
  for (const card of cards) {
    const meta = [card.age && `Age: ${card.age}`, `Casting: ${card.casting === 'any' ? 'Any gender' : card.casting[0].toUpperCase() + card.casting.slice(1)}`].filter(Boolean).join(' · ');
    const traits = card.traits ? pdf.splitTextToSize(`Traits: ${card.traits}`, bodyWidth) as string[] : [];
    const description = card.description ? pdf.splitTextToSize(card.description, bodyWidth) as string[] : [];
    const needed = 34 + (traits.length + description.length) * 13;
    if (y + needed > bottom) { pdf.addPage(options.paperSize, 'portrait'); y = margin; heading(); }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.text(card.name, margin, y); y += 15;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(90, 90, 90); pdf.text(meta, margin, y); y += 16;
    pdf.setTextColor(25, 25, 25); pdf.setFontSize(10);
    if (traits.length) { pdf.text(traits, margin, y); y += traits.length * 13 + 5; }
    if (description.length) { pdf.text(description, margin, y); y += description.length * 13; }
    y += 18;
  }
}

function shapeColor(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  return match ? [parseInt(match[1].slice(0, 2), 16), parseInt(match[1].slice(2, 4), 16), parseInt(match[1].slice(4, 6), 16)] : [90, 110, 98];
}

function rotatedCorners(shape: StageShape, scale: number, left: number, top: number) {
  const centerX = shape.x + shape.width / 2, centerY = shape.y + shape.height / 2, angle = shape.rotation * Math.PI / 180;
  return [[shape.x, shape.y], [shape.x + shape.width, shape.y], [shape.x + shape.width, shape.y + shape.height], [shape.x, shape.y + shape.height]].map(([x, y]) => {
    const dx = x - centerX, dy = y - centerY;
    return [left + (centerX + dx * Math.cos(angle) - dy * Math.sin(angle)) * scale, top + (centerY + dx * Math.sin(angle) + dy * Math.cos(angle)) * scale] as [number, number];
  });
}

export function appendStageLayouts(pdf: jsPDF, layouts: StageSceneLayout[], options: Pick<PdfOptions, 'paperSize'>, useCurrentPage = false) {
  const pageWidth = options.paperSize === 'letter' ? 792 : 841.89;
  const pageHeight = options.paperSize === 'letter' ? 612 : 595.28;
  const left = 48, top = 78, availableWidth = pageWidth - 96, availableHeight = pageHeight - 126;
  const scale = Math.min(availableWidth / 1000, availableHeight / 650);
  for (let sceneIndex = 0; sceneIndex < layouts.length; sceneIndex++) {
    const scene = layouts[sceneIndex];
    if (!useCurrentPage || sceneIndex > 0) pdf.addPage(options.paperSize, 'landscape');
    pdf.setTextColor(25, 29, 27); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
    pdf.text(scene.sceneNumber ? `SCENE ${scene.sceneNumber} · ${scene.heading}` : scene.heading, left, 34);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(105, 112, 108);
    pdf.text('UPSTAGE', pageWidth / 2, 55, { align: 'center' }); pdf.text('AUDIENCE / DOWNSTAGE', pageWidth / 2, pageHeight - 18, { align: 'center' });
    pdf.setDrawColor(55, 62, 58); pdf.setLineWidth(1); pdf.rect(left, top, 1000 * scale, 650 * scale);
    for (const shape of scene.shapes) {
      const [red, green, blue] = shapeColor(shape.color); pdf.setFillColor(red, green, blue); pdf.setDrawColor(red, green, blue);
      const x = left + shape.x * scale, y = top + shape.y * scale, width = shape.width * scale, height = shape.height * scale;
      if (shape.type === 'circle' || shape.type === 'light' || shape.type === 'actor') pdf.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 'F');
      else if (shape.type === 'line') {
        const angle = shape.rotation * Math.PI / 180, centerX = x + width / 2, centerY = y + height / 2;
        const dx = width / 2 * Math.cos(angle) - height / 2 * Math.sin(angle), dy = width / 2 * Math.sin(angle) + height / 2 * Math.cos(angle);
        pdf.setLineWidth(Math.max(2, 8 * scale)); pdf.line(centerX - dx, centerY - dy, centerX + dx, centerY + dy);
      } else {
        const corners = rotatedCorners(shape, scale, left, top); const [first, ...rest] = corners;
        pdf.lines(rest.map((point, index) => [point[0] - (index ? rest[index - 1][0] : first[0]), point[1] - (index ? rest[index - 1][1] : first[1])]), first[0], first[1], [1, 1], 'F', true);
      }
      pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8);
      const label = pdf.splitTextToSize(shape.label || shape.type, Math.max(25, width - 8)) as string[];
      pdf.text(label.slice(0, 2), x + width / 2, y + height / 2, { align: 'center', baseline: 'middle' });
    }
    if (!scene.shapes.length) { pdf.setTextColor(135, 140, 137); pdf.setFont('helvetica', 'italic'); pdf.setFontSize(11); pdf.text('No layout items have been placed for this scene.', pageWidth / 2, pageHeight / 2, { align: 'center' }); }
  }
}

export function createScreenplayPdf(document: FountainDocument, options: PdfOptions, stageLayouts: StageSceneLayout[] = [], characterCards: CharacterCard[] = []) {
  const layout = layoutScreenplay(document, options);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: options.paperSize });
  pdf.setFont('courier', 'normal'); pdf.setFontSize(FONT_SIZE); pdf.setLineWidth(.5);
  layout.pages.forEach((page, pageIndex) => {
    const cards = options.includeCharacterCards ? characterCards : [];
    const hasTitlePage = options.includeTitlePage && Object.keys(document.titlePage).length > 0;
    if (pageIndex === 0 && cards.length && !hasTitlePage) { appendCharacterCards(pdf, cards, options, true); pdf.addPage(options.paperSize, 'portrait'); }
    else if (pageIndex === 1 && cards.length && hasTitlePage) { appendCharacterCards(pdf, cards, options); pdf.addPage(options.paperSize, 'portrait'); }
    else if (pageIndex > 0) pdf.addPage(options.paperSize, 'portrait');
    if (options.watermark) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(42); pdf.setTextColor(225, 225, 225); pdf.text(options.watermark, layout.width / 2, layout.height / 2, { align: 'center', angle: 35 }); }
    pdf.setFont('courier', 'normal'); pdf.setFontSize(9); pdf.setTextColor(100, 100, 100);
    if (options.headerText) pdf.text(options.headerText, 72, 42);
    if (page.number !== null && page.number > 1) pdf.text(String(page.number), layout.width - 72, 42, { align: 'right' });
    if (options.footerText) pdf.text(options.footerText, layout.width / 2, layout.height - 35, { align: 'center' });
    const color = options.revisionColor || '#000000'; const red = parseInt(color.slice(1, 3), 16) || 0, green = parseInt(color.slice(3, 5), 16) || 0, blue = parseInt(color.slice(5, 7), 16) || 0;
    pdf.setTextColor(red, green, blue); pdf.setFontSize(FONT_SIZE);
    for (const block of page.blocks) {
      block.lines.forEach((line, lineIndex) => renderRunLine(pdf, line, block.x, block.y + lineIndex * LINE_HEIGHT, block.width, block.align));
      if (block.sceneNumber) {
        const y = block.y; pdf.setFont('courier', 'normal');
        pdf.text(String(block.sceneNumber), 72, y); pdf.text(String(block.sceneNumber), layout.width - 54, y, { align: 'right' });
      }
      if (options.revisionMarks) { pdf.setFont('courier', 'bold'); pdf.text('*', layout.width - 42, block.y); }
    }
  });
  if (stageLayouts.length) appendStageLayouts(pdf, stageLayouts, options);
  pdf.setProperties({ title: document.titlePage.title || 'Screenplay', author: document.titlePage.author || document.titlePage.authors || '', subject: 'Screenplay exported from Screenwriter' });
  return pdf;
}

export function downloadScreenplayPdf(document: FountainDocument, options: PdfOptions, fountainFilename: string, stageLayouts: StageSceneLayout[] = [], characterCards: CharacterCard[] = []) {
  const name = fountainFilename.replace(/\.(fountain|txt)$/i, '') || 'Screenplay';
  createScreenplayPdf(document, options, stageLayouts, characterCards).save(`${name}.pdf`);
}

export function downloadStageLayoutsPdf(layouts: StageSceneLayout[], options: Pick<PdfOptions, 'paperSize'>, fountainFilename: string) {
  if (!layouts.length) return;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: options.paperSize });
  appendStageLayouts(pdf, layouts, options, true);
  const name = fountainFilename.replace(/\.(fountain|txt)$/i, '') || 'Screenplay'; pdf.save(`${name}-scene-layouts.pdf`);
}

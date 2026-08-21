import type { CharacterStats, FountainDocument, FountainLine, LineType } from './types';

const scenePattern = /^(INT|EXT|EST|INT\/EXT|INT\.\/EXT|I\/E)(?:[.\s-]|$)/i;
const likelyScenePattern = /^(IN|ITN|EX|EXR|ENT|EXT|INT)[.\s-]/i;
const titlePattern = /^([A-Za-z][A-Za-z0-9 _-]*):(?:\s*(.*))?$/;
const transitions = new Set(['CUT TO', 'CUT TO:', 'FADE IN', 'FADE IN:', 'FADE OUT', 'FADE OUT:', 'DISSOLVE TO', 'DISSOLVE TO:', 'SMASH CUT TO', 'SMASH CUT TO:', 'MATCH CUT TO', 'MATCH CUT TO:']);
const countWords = (value: string) => value.match(/[\p{L}\p{N}’']+/gu)?.length ?? 0;

export function unescapeFountain(value: string): string {
  return value.replace(/\\([*_@!~^#.<>\[\]\\])/g, '$1');
}

export function stripInlineNotes(value: string): string {
  return value.replace(/\[\[[\s\S]*?\]\]/g, '').replace(/\[\[[\s\S]*$/g, '').replace(/^[\s\S]*?\]\]/, '').trimEnd();
}

export function printableMarkup(line: FountainLine): string {
  let value = line.type === 'action' ? line.text.trimEnd() : line.text.trim();
  if (line.forced && ['scene', 'character', 'action', 'transition'].includes(line.type)) value = line.text.trim().slice(1).trimStart();
  if (line.type === 'scene') value = value.replace(/\s+#([^#]+)#\s*$/, '').trimEnd();
  if (line.type === 'character') value = value.replace(/\^\s*$/, '').trimEnd();
  if (line.type === 'lyric') value = value.replace(/^~/, '').trimStart();
  if (line.type === 'centered') value = value.replace(/^>\s*/, '').replace(/\s*<$/, '');
  return stripInlineNotes(value);
}

export function printableText(line: FountainLine): string {
  return unescapeFountain(printableMarkup(line));
}

function isTransition(value: string) {
  const upper = value.toUpperCase();
  return upper.endsWith(' TO:') || transitions.has(upper);
}

function normalizeCharacter(value: string) {
  return value.replace(/^@/, '').replace(/\^\s*$/, '').replace(/\s*\(.*\)\s*$/, '').trim();
}

function isNaturalCharacter(value: string, previousBlank: boolean, nextLine: string) {
  if (!previousBlank || !nextLine.trim() || value.length < 2 || value.length > 42 || value.includes(':') || value.endsWith('.') || value.startsWith('>')) return false;
  const withoutDual = value.replace(/\^\s*$/, '').trim();
  return withoutDual === withoutDual.toUpperCase() && /[A-Z0-9]/.test(withoutDual);
}

function classifyTitlePage(rawLines: string[]) {
  const titleLines = new Set<number>();
  const titlePage: Record<string, string> = {};
  let activeKey = '', sawKey = false;
  for (let index = 0; index < rawLines.length; index++) {
    const raw = rawLines[index];
    const match = raw.trim().match(titlePattern);
    if (match) {
      sawKey = true; activeKey = match[1].toLowerCase(); titleLines.add(index);
      titlePage[activeKey] = match[2]?.trim() || '';
      continue;
    }
    if (sawKey && activeKey && /^[ \t]+\S/.test(raw)) {
      titleLines.add(index); titlePage[activeKey] = [titlePage[activeKey], raw.trim()].filter(Boolean).join('\n'); continue;
    }
    if (!raw.trim() && sawKey) { titleLines.add(index); continue; }
    break;
  }
  return { titleLines, titlePage };
}

export function parseFountain(text: string): FountainDocument {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  const title = classifyTitlePage(rawLines);
  const document: FountainDocument = { lines: [], characters: [], diagnostics: [], sceneCount: 0, wordCount: 0, titlePage: title.titlePage };
  const characterMap = new Map<string, CharacterStats>();
  const characterScenes = new Map<string, Set<number>>();
  let expectingDialogue = false, activeCharacter = '', activeDual = false, currentScene = -1, offset = 0, inBoneyard = false, noteDepth = 0;

  rawLines.forEach((lineText, index) => {
    const trimmed = lineText.trim();
    const previousBlank = index === 0 || !rawLines[index - 1].trim();
    const nextLine = rawLines[index + 1] || '';
    const line: FountainLine = { index, start: offset, length: lineText.length, text: lineText, type: 'action' };
    const startsBoneyard = !inBoneyard && lineText.includes('/*');
    const endsBoneyard = lineText.includes('*/');

    if (inBoneyard || startsBoneyard) {
      line.type = 'boneyard'; inBoneyard = !endsBoneyard; expectingDialogue = false; activeCharacter = '';
    } else if (title.titleLines.has(index)) {
      line.type = trimmed ? 'title' : 'empty';
    } else if (!trimmed) {
      line.type = 'empty'; expectingDialogue = false; activeCharacter = ''; activeDual = false;
    } else if (/^={3,}$/.test(trimmed)) {
      line.type = 'page-break'; expectingDialogue = false; activeCharacter = '';
    } else if (noteDepth > 0 || trimmed.startsWith('[[')) {
      line.type = 'note';
    } else if (trimmed.startsWith('#')) {
      line.type = 'section'; expectingDialogue = false; activeCharacter = '';
    } else if (trimmed.startsWith('=') && !trimmed.startsWith('==')) {
      line.type = 'synopsis'; expectingDialogue = false; activeCharacter = '';
    } else if (trimmed.startsWith('~') && !trimmed.startsWith('\\~')) {
      line.type = 'lyric'; line.character = activeCharacter || undefined;
      if (activeCharacter) {
        const stats = characterMap.get(activeCharacter); const words = countWords(printableText(line));
        if (stats) { stats.dialogueLines++; stats.dialogueWords += words; document.wordCount += words; }
      }
    } else if (trimmed.startsWith('>') && trimmed.endsWith('<')) {
      line.type = 'centered'; expectingDialogue = false; activeCharacter = '';
    } else {
      const forcedScene = trimmed.startsWith('.') && !trimmed.startsWith('..');
      const forcedCharacter = trimmed.startsWith('@') && !trimmed.startsWith('\\@');
      const forcedAction = trimmed.startsWith('!') && !trimmed.startsWith('\\!');
      const forcedTransition = trimmed.startsWith('>') && !trimmed.endsWith('<');
      const comparison = forcedScene || forcedCharacter || forcedAction || forcedTransition ? trimmed.slice(1).trimStart() : trimmed;

      if (forcedScene || scenePattern.test(comparison)) {
        line.type = 'scene'; line.forced = forcedScene; line.sceneNumber = comparison.match(/\s+#([^#]+)#\s*$/)?.[1]; document.sceneCount++; currentScene = document.sceneCount; expectingDialogue = false; activeCharacter = '';
      } else if (forcedTransition || isTransition(comparison)) {
        line.type = 'transition'; line.forced = forcedTransition; expectingDialogue = false; activeCharacter = '';
      } else if (forcedCharacter || isNaturalCharacter(comparison, previousBlank, nextLine)) {
        line.type = 'character'; line.forced = forcedCharacter; activeCharacter = normalizeCharacter(comparison); activeDual = /\^\s*$/.test(comparison); line.character = activeCharacter; line.dualDialogue = activeDual; expectingDialogue = true;
        if (!characterMap.has(activeCharacter)) characterMap.set(activeCharacter, { name: activeCharacter, dialogueLines: 0, dialogueWords: 0, sceneCount: 0, estimatedSeconds: 0 });
        if (currentScene >= 0) { if (!characterScenes.has(activeCharacter)) characterScenes.set(activeCharacter, new Set()); characterScenes.get(activeCharacter)!.add(currentScene); }
      } else if (expectingDialogue && trimmed.startsWith('(') && trimmed.endsWith(')')) {
        line.type = 'parenthetical'; line.character = activeCharacter; line.dualDialogue = activeDual;
      } else if (expectingDialogue) {
        line.type = 'dialogue'; line.character = activeCharacter; line.dualDialogue = activeDual;
        const words = countWords(printableText(line)); document.wordCount += words;
        const stats = characterMap.get(activeCharacter); if (stats) { stats.dialogueLines++; stats.dialogueWords += words; }
      } else {
        line.type = 'action'; line.forced = forcedAction; document.wordCount += countWords(printableText(line));
      }
    }

    const opens = (lineText.match(/(?<!\\)\[\[/g) || []).length;
    const closes = (lineText.match(/(?<!\\)\]\]/g) || []).length;
    noteDepth += opens - closes;
    if (line.type === 'action' && likelyScenePattern.test(trimmed)) {
      let replacement = trimmed.toUpperCase();
      if (replacement.startsWith('IN ')) replacement = `INT.${replacement.slice(2)}`;
      else if (replacement.startsWith('EX ')) replacement = `EXT.${replacement.slice(2)}`;
      document.diagnostics.push({ line: index, start: offset, length: lineText.length, message: 'Possible scene heading typo or missing INT./EXT. prefix.', replacement });
    }
    if (line.type === 'transition' && !line.forced && !trimmed.endsWith(':'))
      document.diagnostics.push({ line: index, start: offset, length: lineText.length, message: 'Transitions conventionally end with a colon.', replacement: `${trimmed}:` });
    document.lines.push(line); offset += lineText.length + 1;
  });

  if (inBoneyard) document.diagnostics.push({ line: Math.max(0, rawLines.length - 1), start: text.length, length: 0, message: 'A boneyard is missing its closing */.', replacement: '\n*/' });
  if (noteDepth > 0) document.diagnostics.push({ line: Math.max(0, rawLines.length - 1), start: text.length, length: 0, message: 'A note is missing its closing ]].', replacement: ']]' });
  document.characters = [...characterMap.values()].map((stats) => {
    stats.sceneCount = characterScenes.get(stats.name)?.size ?? 0;
    stats.estimatedSeconds = stats.dialogueWords * 0.38 + stats.sceneCount * 8;
    return stats;
  }).sort((a, b) => b.estimatedSeconds - a.estimatedSeconds || a.name.localeCompare(b.name));
  return document;
}

export function estimatedRuntime(document: FountainDocument): string {
  const dialogueWords = document.characters.reduce((sum, character) => sum + character.dialogueWords, 0);
  const seconds = dialogueWords * 0.38 + Math.max(0, document.wordCount - dialogueWords) * 0.3 + document.sceneCount * 8;
  const minutes = seconds / 60;
  return minutes < 1 ? '<1 min' : minutes < 10 ? `${minutes.toFixed(1)} min` : `${Math.round(minutes)} min`;
}

export function lineTypeLabel(type: LineType) {
  return type.replace('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

import { parseFountain } from './fountain';

export interface SmartEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  message: string;
}

function replaceRange(text: string, start: number, end: number, replacement: string, cursorOffset = replacement.length, message = 'Editing…'): SmartEdit {
  const cursor = start + cursorOffset;
  return { text: `${text.slice(0, start)}${replacement}${text.slice(end)}`, selectionStart: cursor, selectionEnd: cursor, message };
}

export function smartKeyEdit(text: string, selectionStart: number, selectionEnd: number, key: 'Enter' | 'Tab', shiftKey = false): SmartEdit {
  if (selectionStart !== selectionEnd) return replaceRange(text, selectionStart, selectionEnd, key === 'Enter' ? '\n' : '    ');
  const lineStart = text.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const nextBreak = text.indexOf('\n', selectionStart);
  const lineEnd = nextBreak < 0 ? text.length : nextBreak;
  const lineText = text.slice(lineStart, lineEnd);
  const atLineEnd = selectionStart === lineEnd;

  if (key === 'Enter') {
    if (shiftKey || !atLineEnd) return replaceRange(text, selectionStart, selectionEnd, '\n', 1, 'Inserted a literal line break');
    const line = parseFountain(text).lines.find((item) => item.start === lineStart);
    const likelyUnfinishedCharacter = line?.type === 'action' && /^@?[A-Z0-9][A-Z0-9 ._()'’^-]{1,41}$/.test(lineText.trim()) && !lineText.trim().endsWith('.');
    const doubleSpaced = line && !likelyUnfinishedCharacter && ['scene', 'action', 'dialogue', 'transition', 'section', 'synopsis', 'centered', 'page-break'].includes(line.type);
    const insertion = doubleSpaced ? '\n\n' : '\n';
    return replaceRange(text, selectionStart, selectionEnd, insertion, insertion.length, doubleSpaced ? 'Advanced to the next screenplay element' : 'Continued the current screenplay element');
  }

  if (shiftKey) return replaceRange(text, selectionStart, selectionEnd, '    ', 4, 'Inserted action indentation');
  if (!atLineEnd) return replaceRange(text, selectionStart, selectionEnd, '    ', 4, 'Inserted action indentation');
  const trimmed = lineText.trim();
  if (!trimmed) return replaceRange(text, lineStart, lineEnd, '@', 1, 'Character cue — press Tab again to cycle element types');
  const markerCycle: Record<string, string> = { '@': '!', '!': '.', '.': '>', '>': '@' };
  if (markerCycle[trimmed] && lineText.trimStart() === trimmed) {
    const replacement = markerCycle[trimmed];
    const label: Record<string, string> = { '@': 'Character', '!': 'Action', '.': 'Scene heading', '>': 'Transition' };
    return replaceRange(text, lineStart, lineEnd, replacement, replacement.length, `${label[replacement]} element`);
  }
  const line = parseFountain(text).lines.find((item) => item.start === lineStart);
  const likelyUnfinishedCharacter = line?.type === 'action' && /^@?[A-Z0-9][A-Z0-9 ._()'’^-]{1,41}$/.test(lineText.trim()) && !lineText.trim().endsWith('.');
  if (line && (['character', 'dialogue', 'lyric'].includes(line.type) || likelyUnfinishedCharacter)) {
    return replaceRange(text, selectionStart, selectionEnd, '\n()', 2, 'Parenthetical — type inside the parentheses');
  }
  return replaceRange(text, selectionStart, selectionEnd, '    ', 4, 'Inserted action indentation');
}

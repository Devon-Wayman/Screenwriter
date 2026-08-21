import { describe, expect, it } from 'vitest';
import { UndoHistory } from './history';

const entry = (text: string) => ({ text, selectionStart: text.length, selectionEnd: text.length });

describe('UndoHistory', () => {
  it('groups a burst of typing into one undo step', () => {
    const history = new UndoHistory(entry(''));
    history.record(entry('H'), 'insertText', 100);
    history.record(entry('He'), 'insertText', 200);
    history.record(entry('Hello'), 'insertText', 300);
    expect(history.undo()?.text).toBe('');
    expect(history.redo()?.text).toBe('Hello');
  });

  it('keeps separated and structural edits as distinct steps', () => {
    const history = new UndoHistory(entry('A'));
    history.record(entry('AB'), 'insertText', 100);
    history.record(entry('ABC'), 'insertText', 1000);
    history.record(entry('ABC\n\n'), 'structural', 1100);
    expect(history.undo()?.text).toBe('ABC');
    expect(history.undo()?.text).toBe('AB');
    expect(history.undo()?.text).toBe('A');
  });

  it('discards redo history after a new edit branch', () => {
    const history = new UndoHistory(entry('A'));
    history.record(entry('AB'));
    history.record(entry('ABC'));
    history.undo();
    history.record(entry('ABD'));
    expect(history.canRedo).toBe(false);
    expect(history.current.text).toBe('ABD');
  });

  it('resets history when a different document opens', () => {
    const history = new UndoHistory(entry('old'));
    history.record(entry('changed'));
    history.reset(entry('new file'));
    expect(history.canUndo).toBe(false);
    expect(history.current.text).toBe('new file');
  });
});

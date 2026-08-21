import { describe, expect, it } from 'vitest';
import { smartKeyEdit } from './editing';

describe('smart screenplay editing', () => {
  it('double-spaces after scene headings and dialogue', () => {
    const scene = 'INT. ROOM - DAY';
    expect(smartKeyEdit(scene, scene.length, scene.length, 'Enter').text).toBe(`${scene}\n\n`);
    const dialogue = 'MARA\nHello.';
    expect(smartKeyEdit(dialogue, dialogue.length, dialogue.length, 'Enter').text).toBe(`${dialogue}\n\n`);
  });

  it('continues directly from character and parenthetical elements', () => {
    const character = 'MARA';
    expect(smartKeyEdit(character, character.length, character.length, 'Enter').text).toBe('MARA\n');
    const parenthetical = 'MARA\n(quietly)';
    expect(smartKeyEdit(parenthetical, parenthetical.length, parenthetical.length, 'Enter').text).toBe(`${parenthetical}\n`);
  });

  it('uses Shift+Enter for a literal break', () => {
    const action = 'Mara crosses the room.';
    expect(smartKeyEdit(action, action.length, action.length, 'Enter', true).text).toBe(`${action}\n`);
  });

  it('starts and cycles forced elements with Tab on an empty line', () => {
    expect(smartKeyEdit('', 0, 0, 'Tab').text).toBe('@');
    expect(smartKeyEdit('@', 1, 1, 'Tab').text).toBe('!');
    expect(smartKeyEdit('!', 1, 1, 'Tab').text).toBe('.');
    expect(smartKeyEdit('.', 1, 1, 'Tab').text).toBe('>');
    expect(smartKeyEdit('>', 1, 1, 'Tab').text).toBe('@');
  });

  it('inserts a parenthetical after character or dialogue', () => {
    const character = '@McCLANE';
    const edit = smartKeyEdit(character, character.length, character.length, 'Tab');
    expect(edit.text).toBe('@McCLANE\n()');
    expect(edit.selectionStart).toBe('@McCLANE\n('.length);
    expect(smartKeyEdit('MARA', 4, 4, 'Tab').text).toBe('MARA\n()');
  });
});

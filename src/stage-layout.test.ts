import { describe, expect, it } from 'vitest';
import { reconcileScenes } from './StageLayout';
import type { FountainLine, StageSceneLayout } from './types';

function scene(text: string, sceneNumber?: string): FountainLine {
  return { type: 'scene', text, sceneNumber } as FountainLine;
}

function layout(id: string, heading: string, order: number, sceneNumber?: string): StageSceneLayout {
  return { id, heading, order, sceneNumber, shapes: [], updatedAt: '2026-01-01T00:00:00.000Z' };
}

describe('stage layout scene reconciliation', () => {
  it('keeps a numbered scene layout attached when scenes are reordered', () => {
    const saved = [layout('one', 'INT. HOUSE - DAY', 0, '1'), layout('two', 'EXT. PARK - NIGHT', 1, '2')];
    const result = reconcileScenes(saved, [scene('EXT. PARK - NIGHT', '2'), scene('INT. HOUSE - DAY', '1')]);

    expect(result.map((item) => item.id)).toEqual(['two', 'one']);
    expect(result.map((item) => item.order)).toEqual([0, 1]);
  });

  it('matches an unnumbered scene by heading before falling back to its position', () => {
    const saved = [layout('kitchen', 'INT. KITCHEN - MORNING', 0), layout('street', 'EXT. STREET - DAY', 1)];
    const result = reconcileScenes(saved, [scene('EXT. STREET - DAY'), scene('INT. KITCHEN - MORNING')]);

    expect(result.map((item) => item.id)).toEqual(['street', 'kitchen']);
  });

  it('creates unique local identifiers without requiring a secure browser context', () => {
    const result = reconcileScenes([], [scene('INT. ROOM - DAY'), scene('EXT. STREET - NIGHT')]);

    expect(result[0].id).toMatch(/^stage-/);
    expect(result[0].id).not.toBe(result[1].id);
  });
});

import { describe, expect, it } from 'vitest';
import { conflictCopyName } from './offline';

describe('offline synchronization helpers', () => {
  it('creates a portable, unique Fountain conflict filename', () => {
    expect(conflictCopyName('Draft.fountain', new Date('2026-08-22T15:04:05.123Z')))
      .toBe('Draft (offline conflict 2026-08-22T15-04-05-123Z).fountain');
  });

  it('adds a Fountain extension when a document has none', () => {
    expect(conflictCopyName('Untitled', new Date('2026-08-22T00:00:00Z')))
      .toBe('Untitled (offline conflict 2026-08-22T00-00-00-000Z).fountain');
  });
});

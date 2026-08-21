export interface HistoryEntry {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export class UndoHistory {
  private entries: HistoryEntry[];
  private index = 0;
  private lastGroup = '';
  private lastRecordedAt = 0;

  constructor(initial: HistoryEntry, private readonly limit = 200, private readonly groupWindowMs = 800) {
    this.entries = [{ ...initial }];
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  get current() { return { ...this.entries[this.index] }; }

  reset(entry: HistoryEntry) {
    this.entries = [{ ...entry }]; this.index = 0; this.lastGroup = ''; this.lastRecordedAt = 0;
  }

  record(entry: HistoryEntry, group = 'structural', recordedAt = Date.now()) {
    if (entry.text === this.entries[this.index].text && entry.selectionStart === this.entries[this.index].selectionStart && entry.selectionEnd === this.entries[this.index].selectionEnd) return;
    const canGroup = group !== 'structural' && group === this.lastGroup && recordedAt - this.lastRecordedAt <= this.groupWindowMs && this.index === this.entries.length - 1;
    if (canGroup) this.entries[this.index] = { ...entry };
    else {
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push({ ...entry }); this.index++;
      if (this.entries.length > this.limit) { this.entries.shift(); this.index--; }
    }
    this.lastGroup = group; this.lastRecordedAt = recordedAt;
  }

  undo() {
    if (!this.canUndo) return null;
    this.index--; this.lastGroup = ''; return this.current;
  }

  redo() {
    if (!this.canRedo) return null;
    this.index++; this.lastGroup = ''; return this.current;
  }
}

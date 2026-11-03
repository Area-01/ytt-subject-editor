/** Stores isolated editor snapshots. A new edit discards the redo branch. */
export class EditHistory {
  constructor(limit=50) {
    if (!Number.isSafeInteger(limit) || limit<1) throw new Error('기록 개수가 올바르지 않습니다.');
    this.limit=limit; this.past=[]; this.future=[];
  }
  record(state) {
    this.past.push(structuredClone(state));
    if (this.past.length>this.limit) this.past.shift();
    this.future=[];
  }
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(structuredClone(current));
    return this.past.pop();
  }
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(structuredClone(current));
    if (this.past.length>this.limit) this.past.shift();
    return this.future.pop();
  }
  clear() { this.past=[]; this.future=[]; }
  get canUndo() { return this.past.length>0; }
  get canRedo() { return this.future.length>0; }
}

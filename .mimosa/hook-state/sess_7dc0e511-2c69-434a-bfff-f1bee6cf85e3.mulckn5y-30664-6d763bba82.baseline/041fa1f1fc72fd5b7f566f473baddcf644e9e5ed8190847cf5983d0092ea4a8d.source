export interface InkViewportSnapshot {
  readonly offset: number;
  readonly totalRows: number;
  readonly visibleRows: number;
  readonly followOutput: boolean;
  readonly hiddenAbove: number;
  readonly hiddenBelow: number;
  readonly newOutput: number;
}

export interface InkViewportInput {
  readonly totalRows: number;
  readonly visibleRows: number;
}

/**
 * Keeps transcript navigation independent from the runtime event stream.
 * `offset` is the first visible wrapped row, with zero at the oldest row.
 */
export class InkViewportModel {
  private totalRows = 0;
  private visibleRows = 0;
  private offset = 0;
  private followOutput = true;
  private newOutput = 0;

  constructor(input: InkViewportInput = { totalRows: 0, visibleRows: 0 }) {
    this.setContent(input.totalRows, input.visibleRows);
  }

  snapshot(): InkViewportSnapshot {
    const maximumOffset = this.maximumOffset();
    const offset = clamp(this.offset, 0, maximumOffset);
    return {
      offset,
      totalRows: this.totalRows,
      visibleRows: this.visibleRows,
      followOutput: this.followOutput || maximumOffset === 0,
      hiddenAbove: offset,
      hiddenBelow: Math.max(0, this.totalRows - offset - this.visibleRows),
      newOutput: this.followOutput ? 0 : this.newOutput,
    };
  }

  setContent(totalRows: number, visibleRows: number): InkViewportSnapshot {
    const nextTotalRows = normalizeRows(totalRows);
    const nextVisibleRows = normalizeRows(visibleRows);
    const grewBy = Math.max(0, nextTotalRows - this.totalRows);
    this.totalRows = nextTotalRows;
    this.visibleRows = nextVisibleRows;

    if (this.followOutput || this.maximumOffset() === 0) {
      this.offset = this.maximumOffset();
      this.followOutput = true;
      this.newOutput = 0;
      return this.snapshot();
    }

    this.offset = clamp(this.offset, 0, this.maximumOffset());
    this.newOutput += grewBy;
    return this.snapshot();
  }

  /**
   * Move the transcript by a small number of wrapped rows, as terminal mouse
   * wheels do. PageUp/PageDown remain page-sized navigation for keyboard use.
   */
  scrollBy(deltaRows: number): InkViewportSnapshot {
    const maximumOffset = this.maximumOffset();
    if (maximumOffset === 0 || !Number.isFinite(deltaRows)) return this.snapshot();
    const delta = Math.trunc(deltaRows);
    if (delta === 0) return this.snapshot();
    const startingOffset = this.followOutput ? maximumOffset : this.offset;
    this.offset = clamp(startingOffset + delta, 0, maximumOffset);
    this.followOutput = this.offset === maximumOffset;
    if (this.followOutput) this.newOutput = 0;
    return this.snapshot();
  }

  pageUp(): InkViewportSnapshot {
    const maximumOffset = this.maximumOffset();
    if (maximumOffset === 0) return this.snapshot();
    const page = Math.max(1, this.visibleRows - 1);
    this.offset = clamp(
      this.followOutput ? maximumOffset - page : this.offset - page,
      0,
      maximumOffset,
    );
    this.followOutput = false;
    return this.snapshot();
  }

  pageDown(): InkViewportSnapshot {
    const maximumOffset = this.maximumOffset();
    if (maximumOffset === 0) return this.snapshot();
    const page = Math.max(1, this.visibleRows - 1);
    this.offset = Math.min(
      maximumOffset,
      this.followOutput ? maximumOffset : this.offset + page,
    );
    if (this.offset === maximumOffset) {
      this.followOutput = true;
      this.newOutput = 0;
    }
    return this.snapshot();
  }

  home(): InkViewportSnapshot {
    if (this.maximumOffset() === 0) return this.snapshot();
    this.offset = 0;
    this.followOutput = false;
    return this.snapshot();
  }

  end(): InkViewportSnapshot {
    this.offset = this.maximumOffset();
    this.followOutput = true;
    this.newOutput = 0;
    return this.snapshot();
  }

  private maximumOffset(): number {
    return Math.max(0, this.totalRows - this.visibleRows);
  }
}

function normalizeRows(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export interface PanelLayout {
  /** 0-based live-frame row of the panel's top border. */
  readonly top: number;
  readonly height: number;
}

/**
 * Maps a primary mouse press onto a painted data row of a bordered panel.
 * `headerRows` counts the rows painted above the first data row (top border
 * plus header). Wheel, motion, and non-primary buttons never select a row.
 */
export function panelRowAt(
  click: { readonly button: number; readonly y: number; readonly action: string },
  layout: PanelLayout | undefined,
  headerRows: number,
  rowCount: number,
): number | undefined {
  if (layout === undefined || rowCount <= 0) return undefined;
  if (click.action !== "press") return undefined;
  if ((click.button & 64) !== 0 || (click.button & 32) !== 0) return undefined;
  if ((click.button & 3) !== 0) return undefined;
  const row = click.y - (layout.top + headerRows + 1);
  if (row < 0 || row >= rowCount) return undefined;
  return row;
}

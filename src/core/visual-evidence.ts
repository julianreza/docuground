import type { ReportItem } from './markdown';

export type VisualLocation = { itemIndex: number; rowId: string | null; observedValue: string | boolean | null; labelRegion: number[] | null; valueRegion: number[] | null };

function validRegion(region: number[] | null): region is [number, number, number, number] {
  return !!region && region.length === 4 && region.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) && region[0] < region[2] && region[1] < region[3];
}

export function applyVisualLocations<T extends ReportItem>(items: T[], locations: VisualLocation[]): T[] {
  return items.map((item, index) => {
    if (!item.visual || item.evidenceStatus === 'rejected') return item;
    const matching = locations.filter((location) => location.itemIndex === index);
    const location = matching[0];
    const sameValue = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' ? a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim() : a === b;
    const mismatch = matching.length !== 1 ? 'VISUAL_ITEM_MISMATCH' : !sameValue(location.observedValue, item.value) ? 'VISUAL_VALUE_MISMATCH' : item.rowId && location.rowId !== item.rowId ? 'VISUAL_ROW_MISMATCH' : null;
    const diagnostic = { locations: matching, reason: mismatch };
    const consistent = !mismatch;
    if (!consistent || !validRegion(location.labelRegion) || !validRegion(location.valueRegion)) {
      return { ...item, region: null, localizationDiagnostic: { ...diagnostic, reason: mismatch ?? 'VISUAL_INVALID_COORDINATES' }, reasonCode: mismatch ?? 'VISUAL_INVALID_COORDINATES' };
    }
    const label = location.labelRegion;
    const value = location.valueRegion;
    if (item.rowId && (label[3] < value[1] || value[3] < label[1])) {
      return { ...item, region: null, localizationDiagnostic: { ...diagnostic, reason: 'VISUAL_ROW_ALIGNMENT' }, reasonCode: 'VISUAL_ROW_ALIGNMENT' };
    }
    return { ...item, localizationDiagnostic: diagnostic, region: [Math.min(label[0], value[0]), Math.min(label[1], value[1]), Math.max(label[2], value[2]), Math.max(label[3], value[3])], reasonCode: 'VISUAL_NEEDS_REVIEW' };
  });
}

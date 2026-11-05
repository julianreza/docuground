import { expect, test } from 'bun:test';
import { applyVisualLocations } from '../src/core/visual-evidence';

test('combines label and value boxes only when identity and observed value agree', () => {
  const item = { field: 'amount', value: 'Rp10', page: 1, quote: '', visual: true, rowId: '9', evidenceStatus: 'needs_review', region: [0.7, 0.4, 0.9, 0.5] as [number, number, number, number] };
  const anchors = { itemIndex: 0, rowId: '9', observedValue: 'Rp10', labelRegion: [0.1, 0.4, 0.4, 0.5], valueRegion: [0.7, 0.4, 0.9, 0.5] };
  expect(applyVisualLocations([item], [anchors])[0].region).toEqual([0.1, 0.4, 0.9, 0.5]);
  expect(applyVisualLocations([item], [{ ...anchors, rowId: '10' }])[0].region).toBeNull();
  expect(applyVisualLocations([item], [{ ...anchors, observedValue: 'Rp0' }])[0].region).toBeNull();
  expect(applyVisualLocations([item], [{ ...anchors, labelRegion: [0, 0, 2, 1] }])[0].region).toBeNull();
  expect(applyVisualLocations([item], [])[0].region).toBeNull();
});

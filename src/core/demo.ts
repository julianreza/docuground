import type { Provider } from './extract';

const PDF_HASH = '99b1ca348614718edbb8f88e4ead08c1eab85498a1861d1c844815a2719536d8';
const IMAGE_HASH = 'a502606c1e10d9accfdf54b484586e865eabd53794eaef0991f0f36e11d88207';

export const DEMO_PRESETS = [
  { label: 'PDF · annual revenue', hash: PDF_HASH, sourcePage: 1, instruction: 'Extract Acme Corp and Beta Holdings annual operating revenue for 2023 and 2024.' },
  { label: 'PDF · printed chart values', hash: PDF_HASH, sourcePage: 2, instruction: 'Extract the printed quarterly throughput chart values.' },
  { label: 'Form image · field states', hash: IMAGE_HASH, sourcePage: 1, instruction: 'Extract the backup custodian, microfilm serial, and fiscal tax year field states.' },
  { label: 'Form image · checkboxes', hash: IMAGE_HASH, sourcePage: 1, instruction: 'Extract all Group 1 and Group 2 checkbox states.' },
] as const;

export const DEMO_INSTRUCTION = DEMO_PRESETS[0].instruction;

export function findDemoFixture(hash: string, instruction: string) {
  return DEMO_PRESETS.find((preset) => preset.hash === hash && preset.instruction === instruction) ?? null;
}

export function isDemoFixture(hash: string, instruction: string): boolean {
  return findDemoFixture(hash, instruction) !== null;
}

export const demoProvider: Provider = async ({ pages, instruction }) => {
  if (instruction === DEMO_PRESETS[0].instruction && pages[0]?.text.includes('Stated Research Objective')) {
    return [
      { field: 'Acme Corp revenue 2023', value: '8.4 million USD', page: 1, quote: '8.4 million USD', visual: false },
      { field: 'Acme Corp revenue 2024', value: '10 million USD', page: 1, quote: '10 million USD', visual: false },
      { field: 'Beta Holdings revenue 2023', value: '10 million USD', page: 1, quote: '10 million USD', visual: false },
      { field: 'Beta Holdings revenue 2024', value: '12.5 million USD', page: 1, quote: '12.5 million USD', visual: false },
    ];
  }
  if (instruction === DEMO_PRESETS[1].instruction) {
    const index = pages.findIndex((page) => page.text.includes('Calibrated Chart Figure'));
    if (index < 0) return [];
    return [
      { field: 'Q1 2024 · Native PDF throughput', value: '64.0 pages/min', page: index + 1, quote: '64.0 pages/min', visual: true },
      { field: 'Q2 2024 · Native PDF throughput', value: '72.5 pages/min', page: index + 1, quote: '72.5 pages/min', visual: true },
      { field: 'Q3 2024 · Windowed throughput', value: '75.0 pages/min', page: index + 1, quote: '75.0 pages/min', visual: true },
    ];
  }
  if (instruction === DEMO_PRESETS[2].instruction) {
    return [
      { field: 'Secondary Backup Custodian Name', value: null, valueState: 'blank', page: 1, quote: '', visual: true },
      { field: 'Microfilm Stamp Serial Number', value: null, valueState: 'unreadable', page: 1, quote: '', visual: true },
      { field: 'Applicable Fiscal Tax Year', value: null, valueState: 'ambiguous', page: 1, quote: '', visual: true },
    ];
  }
  if (instruction === DEMO_PRESETS[3].instruction) {
    return [
      { field: 'Group 1 · Standard', value: true, valueState: 'observed', page: 1, quote: '', visual: true },
      { field: 'Group 1 · Expedited', value: false, valueState: 'observed', page: 1, quote: '', visual: true },
      { field: 'Group 1 · Restricted', value: false, valueState: 'observed', page: 1, quote: '', visual: true },
      { field: 'Group 2 · Standard', value: false, valueState: 'observed', page: 1, quote: '', visual: true },
      { field: 'Group 2 · Expedited', value: true, valueState: 'observed', page: 1, quote: '', visual: true },
      { field: 'Group 2 · Restricted', value: null, valueState: 'ambiguous', page: 1, quote: '', visual: true },
    ];
  }
  return [];
};

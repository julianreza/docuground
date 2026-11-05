import { expect, test } from 'bun:test';
import { demoProvider, DEMO_INSTRUCTION, isDemoFixture } from '../src/core/demo';

const hash = '99b1ca348614718edbb8f88e4ead08c1eab85498a1861d1c844815a2719536d8';

test('demo accepts only the designated fixture and instruction', () => {
  expect(isDemoFixture(hash, DEMO_INSTRUCTION)).toBe(true);
  expect(isDemoFixture('wrong', DEMO_INSTRUCTION)).toBe(false);
  expect(isDemoFixture(hash, 'Different instruction')).toBe(false);
});

test('demo emits recorded facts only for the window containing source page one', async () => {
  const first = await demoProvider({bytes:new Uint8Array(),mimeType:'application/pdf',instruction:DEMO_INSTRUCTION,pages:[{number:1,text:'Stated Research Objective: primary objective'}]});
  const later = await demoProvider({bytes:new Uint8Array(),mimeType:'application/pdf',instruction:DEMO_INSTRUCTION,pages:[{number:1,text:'other page'}]});
  expect(first).toHaveLength(4);
  expect(later).toEqual([]);
});

test('supports four distinct recorded scenarios with the correct file type', async () => {
  const { DEMO_PRESETS, findDemoFixture } = await import('../src/core/demo');
  const pdfHash = '99b1ca348614718edbb8f88e4ead08c1eab85498a1861d1c844815a2719536d8';
  const imageHash = 'a502606c1e10d9accfdf54b484586e865eabd53794eaef0991f0f36e11d88207';
  expect(DEMO_PRESETS).toHaveLength(4);
  expect(findDemoFixture(pdfHash, DEMO_PRESETS[1].instruction)?.sourcePage).toBe(2);
  expect(findDemoFixture(imageHash, DEMO_PRESETS[2].instruction)?.sourcePage).toBe(1);
  expect(findDemoFixture(pdfHash, DEMO_PRESETS[2].instruction)).toBeNull();
  const form = await demoProvider({bytes:new Uint8Array(),mimeType:'image/png',instruction:DEMO_PRESETS[3].instruction,pages:[{number:1,text:''}]});
  expect(form).toHaveLength(6);
});

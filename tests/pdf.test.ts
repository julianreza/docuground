import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { parsePdf } from '../src/core/pdf';

test('extracts all pages from the provided benchmark with stable page numbers', async () => {
  const pages = await parsePdf(await readFile('samples/inputs/Gemini Benchmark Test Suite.pdf'));
  expect(pages.map((page) => page.number)).toEqual([1, 2, 3, 4]);
  expect(pages[0].text).toContain('1,450');
  expect(pages[3].text).toContain('ARC-9920-ID');
});

test('rejects malformed PDF data', async () => {
  await expect(parsePdf(Buffer.from('not a pdf'))).rejects.toThrow();
});

test('rejects an oversized file before parsing', async () => {
  await expect(parsePdf(new Uint8Array(25 * 1024 * 1024 + 1))).rejects.toThrow('PDF exceeds 25 MB');
});

test('reads the full 18-page benchmark and preserves late-page evidence', async () => {
  const pages = await parsePdf(await readFile('samples/inputs/Gemini Benchmark Test Suite (1).pdf'));
  expect(pages).toHaveLength(18);
  expect(pages[17].number).toBe(18);
  expect(pages[17].text).toContain('AUD-541');
});

test('renders a selected PDF page as PNG for source inspection', async () => {
  const { renderPdfPage } = await import('../src/core/pdf');
  const png = await renderPdfPage(await readFile('samples/inputs/Gemini Benchmark Test Suite (1).pdf'), 4);
  expect(Array.from(png.slice(0, 8))).toEqual([137,80,78,71,13,10,26,10]);
});

test('rejects page numbers outside the document', async () => {
  const { renderPdfPage } = await import('../src/core/pdf');
  await expect(renderPdfPage(await readFile('samples/inputs/Gemini Benchmark Test Suite (1).pdf'), 19)).rejects.toThrow('Invalid page');
});

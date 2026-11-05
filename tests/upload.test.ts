import { expect, test } from 'bun:test';
import { detectFileType } from '../src/core/upload';

test('recognizes supported file signatures', () => {
  expect(detectFileType(new Uint8Array([37,80,68,70,45]))).toBe('application/pdf');
  expect(detectFileType(new Uint8Array([137,80,78,71,13,10,26,10]))).toBe('image/png');
  expect(detectFileType(new Uint8Array([255,216,255,224]))).toBe('image/jpeg');
});

test('rejects unrecognized files', () => {
  expect(detectFileType(new TextEncoder().encode('fake.pdf'))).toBeNull();
});

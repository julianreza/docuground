import { expect, test } from 'bun:test';
import { scoreExtraction } from '../src/core/evaluation';

test('counts wrong identity and duplicates as false positives', () => {
  const expected = [{ id: 'revenue:2024', value: '10' }];
  const actual = [{ id: 'revenue:2023', value: '10' }, { id: 'revenue:2024', value: '10' }, { id: 'revenue:2024', value: '10' }];
  expect(scoreExtraction(expected, actual)).toEqual({ correct: 1, expected: 1, emitted: 3, recall: 1, precision: 1 / 3 });
});

test('reports undefined rates when denominators are empty', () => {
  expect(scoreExtraction([], [])).toEqual({ correct: 0, expected: 0, emitted: 0, recall: null, precision: null });
});

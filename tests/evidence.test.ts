import { expect, test } from 'bun:test';
import { validateEvidence } from '../src/core/evidence';

test('locates a unique source quote across line breaks', () => {
  expect(validateEvidence({ page: 1, quote: 'Revenue was 10 USD' }, new Map([[1, 'Revenue was\n10 USD']]))).toEqual({ status: 'source_located', excerpt: 'Revenue was\n10 USD' });
});

test('rejects a page outside the provided batch', () => {
  expect(validateEvidence({ page: 2, quote: 'Revenue' }, new Map([[1, 'Revenue']])).status).toBe('rejected');
});

test('marks missing and duplicate quotations for review', () => {
  expect(validateEvidence({ page: 1, quote: '10 USD' }, new Map([[1, '10 USD and 10 USD']])).status).toBe('needs_review');
  expect(validateEvidence({ page: 1, quote: '100 USD' }, new Map([[1, '10 USD']])).status).toBe('needs_review');
});

test('does not match a numeric quote inside a different value', () => {
  expect(validateEvidence({ page: 1, quote: '10' }, new Map([[1, '100']])).status).toBe('needs_review');
});

test('does not match part of a decimal number', () => {
  expect(validateEvidence({ page: 1, quote: '10' }, new Map([[1, '10.5']])).status).toBe('needs_review');
});

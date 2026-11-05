import { expect, test } from 'bun:test';
import { evaluateCase } from '../src/core/benchmark';

const expected = [{ id: 'acme-2024' }, { id: 'beta-2023' }];

test('fails acceptance when extraction precision is below 90 percent', () => {
  const claims = [{ expectedId: 'a', correct: true, supported: true }, ...Array.from({ length: 9 }, () => ({ expectedId: null, correct: false, supported: true }))];
  const result = evaluateCase({ mode: 'live', purpose: 'holdout', coverage: 'complete', runStatus: 'complete', expected: [{ id: 'a' }], claims });
  expect(result.extraction.precision).toBe(0.1);
  expect(result.acceptance).toBe('fail');
});

test('counts duplicate and wrong-context claims as false positives and missing facts', () => {
  const result = evaluateCase({ mode:'live', purpose:'holdout', coverage: 'complete', expected, runStatus: 'complete', claims: [
    { expectedId: 'acme-2024', correct: true, supported: true },
    { expectedId: 'acme-2024', correct: true, supported: true },
    { expectedId: null, correct: false, supported: false },
  ] });
  expect(result.extraction).toEqual({ correct: 1, expected: 2, emitted: 3, recall: 0.5, precision: 1 / 3 });
  expect(result.grounding.precision).toBe(2 / 3);
  expect(result.acceptance).toBe('fail');
});

test('never passes partial annotations or unreviewed grounding', () => {
  const partial = evaluateCase({mode:'live',purpose:'holdout',coverage:'partial', expected, runStatus:'complete', claims:[{expectedId:'acme-2024',correct:true,supported:true}]});
  expect(partial.acceptance).toBe('not_evaluated');
  const missing = evaluateCase({mode:'live',purpose:'holdout',coverage:'complete',expected,runStatus:'complete',claims:[{expectedId:'acme-2024',correct:true,supported:null}]});
  expect(missing.grounding.precision).toBeNull();
  expect(missing.acceptance).toBe('not_evaluated');
});

test('requires complete execution and all claims to be reviewed', () => {
  const result = evaluateCase({mode:'live',purpose:'holdout',coverage:'complete',expected:[{id:'a'}],runStatus:'partial',claims:[{expectedId:'a',correct:true,supported:true}]});
  expect(result.acceptance).toBe('fail');
});

test('does not allow a correct label without a known expected identity', () => {
  expect(() => evaluateCase({mode:'live',purpose:'holdout',coverage:'complete',expected,runStatus:'complete',claims:[{expectedId:'missing',correct:true,supported:true}]})).toThrow();
});

test('refuses acceptance for an unreviewed extraction decision', () => {
  const result = evaluateCase({mode:'live',purpose:'holdout',coverage:'complete',expected:[{id:'a'}],runStatus:'complete',claims:[{expectedId:'a',correct:null,supported:true}]});
  expect(result.extraction.recall).toBeNull();
  expect(result.acceptance).toBe('not_evaluated');
});

test('prevents duplicate expected annotations', () => {
  expect(() => evaluateCase({mode:'live',purpose:'holdout',coverage:'complete',expected:[{id:'a'},{id:'a'}],runStatus:'complete',claims:[]})).toThrow('unique');
});

test('never evaluates recorded demo results as live acceptance', () => {
  const result = evaluateCase({mode:'demo',purpose:'holdout',coverage:'complete',expected:[{id:'a'}],runStatus:'complete',claims:[{expectedId:'a',correct:true,supported:true}]});
  expect(result.extraction.recall).toBe(1);
  expect(result.acceptance).toBe('not_evaluated');
});

test('development examples cannot establish holdout acceptance', () => {
  const result = evaluateCase({mode:'live',purpose:'development',coverage:'complete',expected:[{id:'a'}],runStatus:'complete',claims:[{expectedId:'a',correct:true,supported:true}]});
  expect(result.acceptance).toBe('not_evaluated');
});

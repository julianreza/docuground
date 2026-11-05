import { expect, test } from 'bun:test';
import { evaluateReport } from '../src/core/benchmark-report';

const gold = { purpose:'holdout' as const, coverage: 'complete' as const, expected: [{id:'a'}] };
const report = { mode:'live' as const, status: 'complete' as const, sourceHash: 'hash', reportHash: 'report', items: [
  { evidenceStatus:'source_located' as const }, { evidenceStatus:'rejected' as const }, { evidenceStatus:'needs_review' as const },
] };

test('includes every published item and excludes rejected items', () => {
  const result = evaluateReport(gold, report, { sourceHash:'hash', reportHash:'report', reviews:[
    { itemIndex:0, expectedId:'a', correct:true, supported:true },
    { itemIndex:2, expectedId:null, correct:false, supported:false },
  ] });
  expect(result.extraction.emitted).toBe(2);
  expect(result.extraction.precision).toBe(0.5);
  expect(result.grounding.precision).toBe(0.5);
});

test('missing review prevents acceptance and an incorrect source hash is rejected', () => {
  const result = evaluateReport(gold, report, { sourceHash:'hash', reportHash:'report', reviews:[] });
  expect(result.unreviewedExtraction).toBe(2);
  expect(result.acceptance).toBe('not_evaluated');
  expect(() => evaluateReport(gold, report, {sourceHash:'wrong', reportHash:'report', reviews:[]})).toThrow('hash');
});

test('rejects duplicate and invalid review indices', () => {
  const review = {itemIndex:0,expectedId:'a',correct:true,supported:true};
  expect(() => evaluateReport(gold, report, {sourceHash:'hash',reportHash:'report',reviews:[review,review]})).toThrow();
  expect(() => evaluateReport(gold, report, {sourceHash:'hash',reportHash:'report',reviews:[{...review,itemIndex:1}]})).toThrow();
});

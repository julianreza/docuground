import { expect, test } from 'bun:test';
import { buildReport } from '../src/core/report';

test('requires explicit entity, period and unit to be supported by the quotation', () => {
  const page = { number: 1, text: 'Acme revenue in 2024 was 10 million USD.' };
  const item = { field: 'revenue', value: '10', page: 1, quote: page.text, visual: false, entity: 'Acme', period: '2024', unit: 'million USD' };
  const report = buildReport([page], [item, { ...item, period: '2023' }, { ...item, entity: 'Beta' }, { ...item, unit: 'EUR' }]);
  expect(report.items.map((entry) => entry.evidenceStatus)).toEqual(['source_located', 'needs_review', 'needs_review', 'needs_review']);
  expect(report.items[1].reasonCode).toBe('CONTEXT_NOT_SUPPORTED');
});

test('keeps table cells under review when the quote omits row or column context', () => {
  const page = { number: 1, text: 'Acme revenue FY 2023: 8.4' };
  const cell = { field: 'revenue', value: '8.4', page: 1, visual: false, tableTitle: 'Table 1', rowLabel: 'Acme', columnPath: 'revenue > FY 2023' };
  const report = buildReport([page], [{ ...cell, quote: '8.4' }, { ...cell, quote: page.text }]);
  expect(report.items.map((item) => item.evidenceStatus)).toEqual(['needs_review', 'source_located']);
});

test('marks visual claims for review and rejects citations to unknown pages', () => {
  const report = buildReport([{ number: 1, text: 'Total: 10 USD' }], [
    { field: 'total', value: '10 USD', page: 1, quote: 'Total: 10 USD', visual: false },
    { field: 'checkbox', value: 'checked', page: 1, quote: '', visual: true },
    { field: 'invalid', value: 'yes', page: 2, quote: 'yes', visual: false },
  ]);
  expect(report.status).toBe('partial');
  expect(report.items.map((item) => item.evidenceStatus)).toEqual(['source_located', 'needs_review', 'rejected']);
});

test('requires the value to match the source rather than a substring', () => {
  const report = buildReport([{ number: 1, text: 'Total: 100 USD' }], [
    { field: 'total', value: '10', page: 1, quote: 'Total: 100 USD', visual: false },
  ]);
  expect(report.items[0].evidenceStatus).toBe('needs_review');
});

test('preserves missing fields and checkbox states with visual regions', () => {
  const report = buildReport([{number:1,text:''}], [
    {field:'backup',value:null,valueState:'blank',page:1,quote:'',visual:true,box:[100,200,300,400]},
    {field:'standard',value:false,valueState:'observed',page:1,quote:'',visual:true,box:[500,600,700,800]},
    {field:'tier',value:null,valueState:'ambiguous',page:1,quote:'',visual:true},
  ]);
  expect(report.items.map(item => item.valueState)).toEqual(['blank','observed','ambiguous']);
  expect(report.items.map(item => item.value)).toEqual([null,false,null]);
  expect(report.items[0].region).toEqual([0.2,0.1,0.4,0.3]);
  expect(report.items.every(item => item.evidenceStatus === 'needs_review')).toBe(true);
});

test('rejects invalid visual regions while preserving other items', () => {
  const report = buildReport([{number:1,text:'Amount 10'}], [
    {field:'invalid',value:'x',page:1,quote:'',visual:true,box:[900,100,200,300]},
    {field:'amount',value:'10',page:1,quote:'Amount 10',visual:false},
  ]);
  expect(report.status).toBe('partial');
  expect(report.items.map(item => item.evidenceStatus)).toEqual(['rejected','source_located']);
});

test('rejects inconsistent value states without discarding other results', () => {
  const report = buildReport([{number:1,text:'Amount 10'}], [
    {field:'blank with value',value:'invented',valueState:'blank',page:1,quote:'',visual:true},
    {field:'observed without value',value:null,valueState:'observed',page:1,quote:'',visual:true},
    {field:'amount',value:'10',valueState:'observed',page:1,quote:'Amount 10',visual:false},
  ]);
  expect(report.items.map(item => item.evidenceStatus)).toEqual(['rejected','rejected','source_located']);
  expect(report.items[0].reasonCode).toBe('INVALID_VALUE_STATE');
  expect(report.status).toBe('partial');
});

test('explains rejection for malformed visual region', () => {
  const report = buildReport([{number:1,text:''}], [{field:'mark',value:true,page:1,quote:'',visual:true,box:[100,900,200,100]}]);
  expect(report.items[0].reasonCode).toBe('INVALID_REGION');
});

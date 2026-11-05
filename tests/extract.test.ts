import { expect, test } from 'bun:test';
import { extractDocument, validateInstructionScope } from '../src/core/extract';

test('passes document bytes and instruction to the provider and validates citations', async () => {
  const document = { mimeType: 'application/pdf', bytes: Buffer.from('sample'), pages: [{ number: 1, text: 'Revenue is 10 USD.' }] };
  const report = await extractDocument(document, 'Extract revenue', async (input) => {
    expect(input.instruction).toBe('Extract revenue');
    return [{ field: 'Revenue', value: '10 USD', page: 1, quote: 'Revenue is 10 USD.', visual: false }];
  });
  expect(report.status).toBe('complete');
  expect(report.items[0].evidenceStatus).toBe('source_located');
});

test('rejects malformed provider output', async () => {
  const document = { mimeType: 'application/pdf', bytes: Buffer.from('sample'), pages: [{ number: 1, text: '' }] };
  await expect(extractDocument(document, 'Extract fields', async () => [{ field: 'Bad', page: 'one' }])).rejects.toThrow();
});

test('preserves table identities from structured model output', async () => {
  const document = { mimeType:'application/pdf', bytes:Buffer.from('sample'), pages:[{number:1,text:'Acme 10 USD'}] };
  const result = await extractDocument(document, 'Extract table', async () => [{field:'revenue',value:'10 USD',page:1,quote:'Acme 10 USD',visual:false,tableTitle:'Results',rowLabel:'Acme',columnPath:'Revenue / 2024'}]);
  expect(result.items[0].tableTitle).toBe('Results');
  expect(result.items[0].columnPath).toBe('Revenue / 2024');
});

test('validates instruction scope to prevent out-of-document actions', () => {
  expect(validateInstructionScope('Extract all financial tables').supported).toBe(true);
  expect(validateInstructionScope('Search the web for competitor pricing').supported).toBe(false);
  expect(validateInstructionScope('Execute python code to analyze data').supported).toBe(false);
  expect(validateInstructionScope('').supported).toBe(false);
});

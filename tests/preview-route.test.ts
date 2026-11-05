import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { POST } from '../app/api/preview/route';

test('renders the requested page of the supplied PDF locally', async () => {
  const form = new FormData();
  form.append('file', new File([await readFile('samples/inputs/Gemini Benchmark Test Suite (1).pdf')], 'sample.pdf'));
  form.append('page', '4');
  const response = await POST(new Request('http://localhost/api/preview', {method:'POST', body:form}));
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
});

test('rejects invalid files', async () => {
  const form = new FormData();
  form.append('file', new File(['not pdf'], 'sample.pdf'));
  form.append('page', '1');
  expect((await POST(new Request('http://localhost/api/preview', {method:'POST', body:form}))).status).toBe(400);
});

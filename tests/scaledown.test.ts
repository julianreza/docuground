import { expect, test } from 'bun:test';
import { ScaleDown } from '../src/core/scaledown';
import { capabilities } from '../src/core/config';
import type { ReportItem } from '../src/core/markdown';

test('optional capabilities depend on configuration, with an optional router key', () => {
  const saved = { ...process.env };
  try {
    process.env.NINEROUTER_BASE_URL = 'http://router/v1';
    process.env.NINEROUTER_MODEL = 'vision';
    delete process.env.NINEROUTER_API_KEY;
    process.env.SCALEDOWN_ENABLED = 'true';
    delete process.env.SCALEDOWN_API_KEY;
    expect(capabilities()).toMatchObject({ nineRouter: true, scaleDown: false });
    process.env.SCALEDOWN_API_KEY = 'test';
    expect(capabilities().scaleDown).toBe(true);
    process.env.NINEROUTER_BASE_URL = 'not a URL';
    expect(capabilities().nineRouter).toBe(false);
  } finally { process.env = saved; }
});

test('only publishes a unique locally verified citation and retains review state', async () => {
  const original = globalThis.fetch;
  const text = 'Revenue was 42 USD in 2024.';
  let result = { text: '42 USD', start: 12, end: 18 };
  globalThis.fetch = Object.assign(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ entities: [result] }) } }] }), { preconnect: original.preconnect }) as typeof fetch;
  try {
    const cdm = new ScaleDown('secret', new AbortController().signal);
    const item: ReportItem = { field: 'Revenue', value: '42 USD', page: 1, quote: 'wrong', evidenceStatus: 'needs_review' };
    await cdm.suggest([item], [{ number: 1, text }]);
    expect(item.cdmSuggestion).toBe('42 USD');
    expect(item.evidenceStatus).toBe('needs_review');
    result = { text: '42 USD', start: 0, end: 6 };
    const invalid = { ...item, cdmSuggestion: undefined };
    await cdm.suggest([invalid], [{ number: 1, text }]);
    expect(invalid.cdmSuggestion).toBeUndefined();
  } finally { globalThis.fetch = original; }
});

import { expect, test } from 'bun:test';
import { readEventStream } from '../src/core/stream';

test('handles events split across arbitrary byte chunks', async () => {
  const bytes = new TextEncoder().encode('data: {"type":"progress","progress":{"type":"started","pages":[1]}}\n\ndata: {"type":"result","report":{"status":"complete"}}\n\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 7)); controller.enqueue(bytes.slice(7, 42)); controller.enqueue(bytes.slice(42)); controller.close(); } });
  const events: unknown[] = [];
  await readEventStream(body, (event) => events.push(event));
  expect(events).toEqual([{type:'progress',progress:{type:'started',pages:[1]}},{type:'result',report:{status:'complete'}}]);
});

test('rejects an incomplete event at end of stream', async () => {
  const body = new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('data: {"type":'));controller.close();}});
  await expect(readEventStream(body, () => {})).rejects.toThrow('incomplete');
});

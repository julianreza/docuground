export async function readEventStream(body: ReadableStream<Uint8Array>, onEvent: (event: unknown) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 10 * 1024 * 1024) throw new Error('Event stream exceeded the size limit');
      let separator: number;
      while ((separator = buffer.indexOf('\n\n')) >= 0) {
        const message = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        if (message.startsWith('data: ')) onEvent(JSON.parse(message.slice(6)));
      }
      if (done) break;
    }
    if (buffer.trim()) throw new Error('Event stream ended with an incomplete message');
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

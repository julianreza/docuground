interface Answer {
  id: string;
  value: string;
}

export function scoreExtraction(expected: readonly Answer[], actual: readonly Answer[]) {
  const remaining = new Map(expected.map((item) => [item.id, item.value]));
  let correct = 0;
  for (const item of actual) {
    if (remaining.get(item.id) === item.value) {
      correct++;
      remaining.delete(item.id);
    }
  }
  return {
    correct,
    expected: expected.length,
    emitted: actual.length,
    recall: expected.length ? correct / expected.length : null,
    precision: actual.length ? correct / actual.length : null,
  };
}

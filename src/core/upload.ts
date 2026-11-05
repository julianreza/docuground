export function detectFileType(bytes: Uint8Array): string | null {
  const startsWith = (prefix: number[]) => prefix.every((value, index) => bytes[index] === value);
  if (startsWith([37, 80, 68, 70, 45])) return 'application/pdf';
  if (startsWith([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (startsWith([255, 216, 255])) return 'image/jpeg';
  return null;
}

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfPage {
  number: number;
  text: string;
}

export async function parsePdf(bytes: Uint8Array): Promise<PdfPage[]> {
  if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('PDF exceeds 25 MB');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const document = await task.promise;
    const pages: PdfPage[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push({
        number,
        text: content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

export async function renderPdfPage(bytes: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('PDF exceeds 25 MB');
  const { createCanvas } = await import('@napi-rs/canvas');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const document = await task.promise;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) throw new Error('Invalid page');
    const page = await document.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvas: null, canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, viewport }).promise;
    const png = await canvas.encode('png');
    page.cleanup();
    return png;
  } finally {
    await task.destroy();
  }
}

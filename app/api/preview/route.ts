import { parsePdf, renderPdfPage } from '@/src/core/pdf';
import { detectFileType } from '@/src/core/upload';
export async function POST(request: Request) {
  const limit = 25 * 1024 * 1024;
  if (Number(request.headers.get('content-length') || 0) > limit + 65536) return new Response('File too large', {status:413});
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const page = Number(form?.get('page'));
  if (!(file instanceof File) || file.size === 0 || file.size > limit || !Number.isInteger(page) || page < 1) return new Response('Invalid preview request', {status:400});
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (detectFileType(bytes) !== 'application/pdf') return new Response('Invalid PDF', {status:400});
  try {
    const pages = await parsePdf(bytes);
    const png = await renderPdfPage(bytes, Math.min(page, pages.length));
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'x-page-count': String(pages.length),
      },
    });
  } catch {
    return new Response('Could not render page', { status: 400 });
  }
}

export function capabilities() {
  const base = process.env.NINEROUTER_BASE_URL?.trim() || '';
  let nineRouter = false;
  try {
    const url = new URL(base);
    nineRouter = ['http:', 'https:'].includes(url.protocol) && url.pathname.replace(/\/$/, '') === '/v1' && !url.search && !url.hash && !url.username && !url.password && !!process.env.NINEROUTER_MODEL?.trim();
  } catch { /* Optional configuration. */ }
  return { deepSeek: !!process.env.DEEPSEEK_API_KEY?.trim(), gemini: !!process.env.GEMINI_API_KEY?.trim(), nineRouter, scaleDown: process.env.SCALEDOWN_ENABLED === 'true' && !!process.env.SCALEDOWN_API_KEY?.trim() };
}

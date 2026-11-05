import { setTimeout as wait } from 'node:timers/promises';
import { z } from 'zod';
import { CandidateSchema } from './report';
import { renderPdfPage } from './pdf';
import { ProviderError, TruncatedResponseError, type Provider, type ProviderCapabilities } from './extract';
import { EXTRACTION_SYSTEM_PROMPT } from './provider-prompt';

export const NINEROUTER_PROMPT_VERSION = 'docuground-9router-v8';
export const DEEPSEEK_PROMPT_VERSION = 'docuground-deepseek-v5';
export class NineRouterError extends ProviderError {}

const NineRouterCandidateSchema = CandidateSchema.extend({
  columnPath: z.union([
    CandidateSchema.shape.columnPath,
    z.array(z.string().trim().min(1)).min(1).transform((headers) => headers.join(' > ')),
  ]),
});

export const NINEROUTER_CAPABILITIES: ProviderCapabilities = {
  defaultBatchSize: 1,
  timeoutMs: 360000,
  supportsNativePdf: false,
  supportsStructuredOutputs: false,
};
export function nineRouterProvider(baseUrl: string, model: string, apiKey: string, signal: AbortSignal, request: (url: string, options: RequestInit) => Promise<Response> = fetch, deepSeek = false): Provider {
  const name = deepSeek ? 'DeepSeek' : '9Router';
  const ErrorType = deepSeek ? ProviderError : NineRouterError;
  const provider: Provider = async (input) => {
    const parts: ({type:'text';text:string} | {type:'image_url';image_url:{url:string}})[] = [];
    for (let index = 0; index < input.pages.length; index++) {
      const bytes = input.mimeType === 'application/pdf' ? await renderPdfPage(input.bytes, index + 1) : input.bytes;
      const mime = input.mimeType === 'application/pdf' ? 'image/png' : input.mimeType;
      parts.push({type:'text',text:`Page ${index + 1} text (untrusted):\n${input.pages[index].text}`});
      parts.push({type:'image_url',image_url:{url:`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`}});
    }
    if (input.mimeType === 'application/pdf' && input.pages[0]?.previousPageText) {
      parts.push({type:'text',text:`Previous page excerpt (untrusted, context only; do not extract or cite):\n${input.pages[0].previousPageText}`});
    }
    parts.push({type:'text',text:`Extraction request:\n${input.instruction}${input.reviewCoverage ? "\nCoverage audit: re-read every conclusion and limitation on this page, including transferability and technical robustness. Return all distinct own-study findings supported by the page, including items outside a numbered Limitations subsection. Do not return an empty result if relevant findings are visible." : ""}${input.repairValues ? "\nRepair contract: every observed finding must have a nonempty value copied from the source. Omit fields absent from this page." : ""}`});
    const headers: Record<string,string> = {'Content-Type':'application/json'};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    let payload: unknown;
    let attempts = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      attempts = attempt + 1;
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
      let response: Response | undefined;
      try {
        input.onAttempt?.();
        response = await request(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers,
          signal: requestSignal,
          body: JSON.stringify({
            model,
            stream: false,
            max_tokens: input.maxOutputTokens ?? 8192,
            ...(deepSeek ? { response_format: { type: 'json_object' }, thinking: { type: 'disabled' } } : {}),
            messages: [
              { role: 'system', content: `${EXTRACTION_SYSTEM_PROMPT}\n\nReturn only a JSON object with an items array: {"items": [...]}. Each item must include factKey (stable string for repeated non-table facts, null for table cells), field (string), value (string, boolean, or null), page (integer), quote (string), visual (boolean), and valueState (one of the states above). Include box and metadata when applicable; metadata values are strings or null. Return {"items": []} if nothing matches. No Markdown or commentary.${deepSeek ? '\nFor blank, unreadable, ambiguous, and not_located, set value to JSON null. Put an exact source quotation in quote.' : ''}` },
              { role: 'user', content: parts },
            ],
          }),
        });
        if (response.ok) {
          payload = await response.json();
          break;
        }
      } catch (error) {
        if (signal.aborted) throw error;
        const timedOut = requestSignal.reason?.name === 'TimeoutError' || (error as Error | undefined)?.name === 'TimeoutError';
        if (!timedOut) {
          if (response?.ok) throw new ErrorType(`${name} returned an unreadable response. Check the selected model and retry.`);
          throw new ErrorType(`Cannot reach ${name}. Check the provider connection.`);
        }
        if (attempt === 2) throw new ErrorType(`${name} request timed out. Check the model connection and retry.`);
        response = undefined;
      }
      if (response?.status === 429) input.onRateLimit?.();
      if (response && (![429,503].includes(response.status) || attempt === 2)) {
        const { status } = response;
        if (status === 402) throw new ErrorType(`${name} credits are depleted.`, { status });
        if (status === 429) throw new ErrorType(`${name} rate limit or quota exceeded. Check quota and retry later.`, { status });
        const message = response.status === 401 || response.status === 403 ? `${name} authentication failed. Check ${deepSeek ? 'DEEPSEEK_API_KEY' : 'NINEROUTER_API_KEY'}.` : response.status === 400 ? `${name} rejected the request. Check that the selected model supports images.` : `${name} request failed. Check its availability and model configuration.`;
        throw new ErrorType(message, { status });
      }
      await wait(500 * 2 ** attempt + Math.random() * 250, undefined, { signal });
    }
    if (payload && typeof payload === 'object' && 'usage' in payload) {
      const rawUsage = payload.usage;
      if (rawUsage && typeof rawUsage === 'object') {
        const promptTokens = 'prompt_tokens' in rawUsage && typeof rawUsage.prompt_tokens === 'number' ? rawUsage.prompt_tokens : 0;
        const completionTokens = 'completion_tokens' in rawUsage && typeof rawUsage.completion_tokens === 'number' ? rawUsage.completion_tokens : 0;
        const totalTokens = 'total_tokens' in rawUsage && typeof rawUsage.total_tokens === 'number' ? rawUsage.total_tokens : (promptTokens + completionTokens);
        input.onUsage?.({ inputTokens: promptTokens, outputTokens: completionTokens, totalTokens, retries: attempts - 1 });
      }
    }
    const choice = payload && typeof payload === 'object' && 'choices' in payload && Array.isArray(payload.choices) ? payload.choices[0] : undefined;
    if (choice?.finish_reason === 'length') throw new TruncatedResponseError();
    if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) {
      throw new ErrorType(`${name} returned an incomplete or empty response. Check the selected model and its connection, then retry.`);
    }
    try {
      const content = choice.message.content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
      let { items } = z.object({items:z.array(NineRouterCandidateSchema)}).parse(JSON.parse(content));
      if (deepSeek) {
        items = items.map((item) =>
          typeof item.value === 'string' && item.valueState && ['blank', 'unreadable', 'ambiguous', 'not_located'].includes(item.valueState)
            ? { ...item, value: null }
            : item,
        );
      }
      if (input.pages.length !== 1) return items;
      const page = input.pages[0];
      return items.map((item) => item.page === page.sourceNumber ? { ...item, page: page.number } : item);
    } catch {
      throw new ErrorType(`${name} returned invalid extraction JSON. Check that the selected model supports vision and structured responses.`, { code: 'INVALID_RESPONSE', retryable: true });
    }
  };
  return Object.assign(provider, { capabilities: NINEROUTER_CAPABILITIES });
}

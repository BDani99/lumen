export interface AI33TaskResponse {
  id: string;
  status: 'doing' | 'done' | 'failed' | 'queued';
  error_message: string | null;
  progress: number;
  metadata?: any;
  task_id?: string;
}

export type AI33VoiceProvider = 'elevenlabs' | 'minimax' | 'fishaudio';

export interface AI33Voice {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  tags?: string[];
  preview_url?: string | null;
}

export interface AI33VoicesPagination {
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export interface ListVoicesParams {
  provider: AI33VoiceProvider;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  language?: string;
  gender?: string;
  filters?: string;
}

export interface AI33DictionaryRule {
  from: string;
  to: string;
  matchType?: 'word' | 'contains';
  caseSensitive?: boolean;
}

export interface AI33Dictionary {
  id: number;
  name: string;
  rules: AI33DictionaryRule[];
}

export function clampTtsSpeed(speed: number): number {
  return Math.min(1.5, Math.max(0.5, speed));
}

/** Turn a raw AI33Client error into a clear, actionable Hungarian message for API responses. */
export function ai33UserMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Already a human-readable, health-check-enriched message from AI33Client — pass through.
  if (/\(AI33\)\./.test(msg)) return msg;
  if (/AI33 request timed out/i.test(msg)) {
    return 'A hangszolgáltatás nem válaszolt időben (AI33). Próbáld újra.';
  }
  if (/AI33 API error/i.test(msg)) {
    return 'A hangszolgáltatás átmenetileg nem elérhető (AI33). Próbáld újra pár másodperc múlva.';
  }
  return msg;
}

/** Map ISO codes to Minimax `language_boost` enum names. */
export function toMinimaxLanguageBoost(code: string): string {
  const map: Record<string, string> = {
    hu: 'Hungarian',
    en: 'English',
    de: 'German',
    fr: 'French',
    es: 'Spanish',
    it: 'Italian',
    pt: 'Portuguese',
    pl: 'Polish',
    nl: 'Dutch',
    ru: 'Russian',
    tr: 'Turkish',
    zh: 'Chinese',
    ja: 'Japanese',
    ko: 'Korean',
    ar: 'Arabic',
    hi: 'Hindi',
    vi: 'Vietnamese',
    auto: 'auto',
  };
  const key = code.trim().toLowerCase();
  return map[key] || code;
}

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** AI33 returns 503 + server_busy when task status is polled too aggressively. */
export function isAi33ServerBusy(status: number, errorText: string): boolean {
  return (
    status === 503 ||
    /server_busy/i.test(errorText) ||
    /temporarily busy/i.test(errorText) ||
    /Task polling temporarily busy/i.test(errorText)
  );
}

/** 502/503/504/429 are transient gateway/rate-limit errors — worth retrying even without "busy" text. */
function isAi33RetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

const AI33_REQUEST_TIMEOUT_MS = 45_000;

/** AI33 is a third-party proxy — a hung upstream must fail fast instead of blocking until the platform kills the function. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = AI33_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new Error(`AI33 request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Voice-id prefix → AI33 provider, mirrors the prefixing convention used across the app. */
function providerFromVoiceId(voiceId: string): AI33VoiceProvider | null {
  if (voiceId.startsWith('elevenlabs_')) return 'elevenlabs';
  if (voiceId.startsWith('minimax_')) return 'minimax';
  if (voiceId.startsWith('fishaudio_')) return 'fishaudio';
  return null;
}

const PROVIDER_LABEL: Record<AI33VoiceProvider, string> = {
  elevenlabs: 'ElevenLabs',
  minimax: 'MiniMax',
  fishaudio: 'Fish Audio',
};

export class AI33Client {
  private apiKey: string;
  private baseUrl = 'https://api.ai33.pro';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.AI33_API_KEY || '';
  }

  private async request(
    endpoint: string,
    options: RequestInit = {},
    retries = 0
  ): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'xi-api-key': this.apiKey,
      ...(options.headers || {}),
    };

    const response = await fetchWithTimeout(url, { ...options, headers });
    if (!response.ok) {
      const errorText = await response.text();
      const busy = isAi33ServerBusy(response.status, errorText);
      if ((busy || isAi33RetryableStatus(response.status)) && retries < 6) {
        const wait = Math.min(15_000, 1500 * Math.pow(1.6, retries));
        console.warn(
          `[AI33] ${response.status}${busy ? ' server_busy' : ''} on ${endpoint} — retry ${retries + 1}/6 in ${Math.round(wait / 1000)}s. Body: ${errorText.slice(0, 300) || '(empty)'}`
        );
        await sleepMs(wait);
        return this.request(endpoint, options, retries + 1);
      }
      console.error(
        `[AI33] request failed on ${endpoint}: ${response.status} — ${errorText.slice(0, 500) || '(empty body)'}`
      );
      throw new Error(`AI33 API error (${response.status}): ${errorText}`);
    }
    return response.json();
  }

  private async requestFormData(
    endpoint: string,
    formData: FormData,
    retries = 0
  ): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'xi-api-key': this.apiKey,
      // Do not set Content-Type for FormData, let the browser/fetch set it with boundary
    };

    const response = await fetchWithTimeout(url, { method: 'POST', headers, body: formData });
    if (!response.ok) {
      const errorText = await response.text();
      const busy = isAi33ServerBusy(response.status, errorText);
      if ((busy || isAi33RetryableStatus(response.status)) && retries < 4) {
        const wait = Math.min(12_000, 2000 * (retries + 1));
        console.warn(
          `[AI33] ${response.status}${busy ? ' server_busy' : ''} on ${endpoint} — retry ${retries + 1}/4 in ${Math.round(wait / 1000)}s. Body: ${errorText.slice(0, 300) || '(empty)'}`
        );
        await sleepMs(wait);
        return this.requestFormData(endpoint, formData, retries + 1);
      }
      console.error(
        `[AI33] request failed on ${endpoint}: ${response.status} — ${errorText.slice(0, 500) || '(empty body)'}`
      );
      throw new Error(`AI33 API error (${response.status}): ${errorText}`);
    }
    return response.json();
  }

  /** Current AI33 credit balance (`GET /v1/credits`). */
  async getCredits(): Promise<number> {
    const data = await this.request('/v1/credits');
    return Number(data?.credits ?? 0);
  }

  /** Per-provider upstream status (`GET /v1/health-check`) — "good" | "degraded" | "overloaded". */
  async healthCheck(): Promise<Record<string, string>> {
    const data = await this.request('/v1/health-check');
    return data?.data || {};
  }

  /** Best-effort enrichment: fold the relevant provider's health status into a failed-request error. Never throws. */
  private async describeFailure(err: unknown, provider: AI33VoiceProvider | null): Promise<Error> {
    const base = err instanceof Error ? err.message : String(err);
    if (!provider) return new Error(base);
    try {
      const health = await this.healthCheck();
      const status = health[provider];
      if (status && status !== 'good') {
        return new Error(
          `${PROVIDER_LABEL[provider]} jelenleg ${status === 'overloaded' ? 'túlterhelt' : 'akadozik'} (AI33). Próbáld újra pár perc múlva. (${base})`
        );
      }
    } catch {
      // health-check itself failed — fall through to the original error
    }
    return new Error(base);
  }

  async listVoices(params: ListVoicesParams): Promise<{
    voices: AI33Voice[];
    pagination: AI33VoicesPagination;
  }> {
    const query = new URLSearchParams();
    query.set('provider', params.provider);
    query.set('page', String(params.page ?? 1));
    query.set('page_size', String(params.pageSize ?? 30));

    const search = params.search?.trim();
    if (search) {
      query.set('search', search);
      query.set('q', search);
    }
    if (params.sort) query.set('sort', params.sort);
    if (params.language) query.set('language', params.language);
    if (params.gender) query.set('gender', params.gender);
    if (params.filters) query.set('filters', params.filters);

    let data: any;
    try {
      data = await this.request(`/v3/voices?${query.toString()}`);
    } catch (err) {
      throw await this.describeFailure(err, params.provider);
    }
    const voices: AI33Voice[] = (data.data || data.voices || []).map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name || v.voice_id,
      language: v.language || undefined,
      gender: v.gender || undefined,
      tags: Array.isArray(v.tags) ? v.tags : [],
      preview_url: v.preview_url || null,
    }));

    const paginationRaw = data.pagination || {};
    const page = Number(paginationRaw.page ?? params.page ?? 1);
    const pageSize = Number(paginationRaw.page_size ?? params.pageSize ?? 30);
    const total = Number(paginationRaw.total ?? voices.length);
    const hasMore =
      typeof paginationRaw.has_more === 'boolean'
        ? paginationRaw.has_more
        : page * pageSize < total;

    return {
      voices,
      pagination: {
        page,
        page_size: pageSize,
        total,
        has_more: hasMore,
      },
    };
  }

  /** Resolve display name / meta for a prefixed or bare voice_id via library search. */
  async resolveVoice(
    voiceId: string,
    provider?: AI33VoiceProvider
  ): Promise<AI33Voice | null> {
    const trimmed = voiceId.trim();
    if (!trimmed) return null;

    const prefixes: AI33VoiceProvider[] = [
      'elevenlabs',
      'minimax',
      'fishaudio',
    ];
    let inferredProvider = provider;
    let bareId = trimmed;
    for (const p of prefixes) {
      if (trimmed.startsWith(`${p}_`)) {
        inferredProvider = p;
        bareId = trimmed.slice(p.length + 1);
        break;
      }
    }
    if (!inferredProvider) inferredProvider = 'elevenlabs';

    const queries = [...new Set([trimmed, bareId].filter(Boolean))];
    for (const q of queries) {
      const { voices } = await this.listVoices({
        provider: inferredProvider,
        search: q,
        page: 1,
        pageSize: 50,
      });
      const exact =
        voices.find((v) => v.voice_id === trimmed) ||
        voices.find((v) => v.voice_id === `${inferredProvider}_${bareId}`) ||
        voices.find((v) => v.voice_id.endsWith(bareId)) ||
        voices.find((v) => v.voice_id === bareId);
      if (exact) return exact;
    }
    return null;
  }

  async generateTTSv3(
    text: string,
    voiceId: string,
    speed = 1,
    options?: {
      modelId?: string;
      /** ISO language code (hu, en, …). Mapped per provider when sending. */
      language?: string;
      provider?: AI33VoiceProvider;
      /** Applies saved pronunciation rules before synthesis — audio only, text is unchanged. */
      pronunciationDictionaryId?: string;
    }
  ) {
    const formData = new FormData();
    formData.append('text', text);
    formData.append('voice_id', voiceId);
    formData.append('speed', clampTtsSpeed(speed).toString());
    formData.append('with_transcript', 'true');
    if (options?.modelId?.trim()) {
      formData.append('model_id', options.modelId.trim());
    }
    if (options?.pronunciationDictionaryId?.trim()) {
      formData.append('pronunciation_dictionary_id', options.pronunciationDictionaryId.trim());
    }

    const provider = options?.provider || providerFromVoiceId(voiceId) || 'elevenlabs';

    const language = options?.language?.trim();
    if (language) {
      // Generic field many AI33 proxies accept
      formData.append('language', language);

      if (provider === 'elevenlabs') {
        formData.append('language_code', language);
      } else if (provider === 'minimax') {
        formData.append('language_boost', toMinimaxLanguageBoost(language));
      } else if (provider === 'fishaudio') {
        // Fish Audio expects ISO-style language; already appended as `language`
      }
    }

    try {
      return await this.requestFormData(`/v3/text-to-speech`, formData);
    } catch (err) {
      throw await this.describeFailure(err, provider);
    }
  }

  async generateEdgeTTS(text: string, voice = 'en-US-AriaNeural', speed = 1) {
    return this.request(`/v1e/task/text-to-speech`, {
      method: 'POST',
      body: JSON.stringify({
        text,
        voice,
        speed,
        with_transcript: true,
        with_loudnorm: false
      })
    });
  }

  async getTaskStatus(taskId: string): Promise<AI33TaskResponse> {
    return this.request(`/v1/task/${taskId}`);
  }

  /** List the account's saved pronunciation dictionaries (`GET /v3/dictionaries`). */
  async listDictionaries(): Promise<AI33Dictionary[]> {
    const data = await this.request('/v3/dictionaries');
    const raw = data?.data || data?.dictionaries || [];
    return (Array.isArray(raw) ? raw : []).map((d: any) => ({
      id: Number(d.id),
      name: String(d.name || ''),
      rules: Array.isArray(d.rules) ? d.rules : [],
    }));
  }

  async getDictionary(id: number | string): Promise<AI33Dictionary> {
    const data = await this.request(`/v3/dictionaries/${id}`);
    const d = data?.dictionary || data;
    return { id: Number(d.id), name: String(d.name || ''), rules: Array.isArray(d.rules) ? d.rules : [] };
  }

  async createDictionary(input: { name: string; rules: AI33DictionaryRule[] }): Promise<AI33Dictionary> {
    const data = await this.request('/v3/dictionaries', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const d = data?.dictionary || data;
    return { id: Number(d.id), name: String(d.name || ''), rules: Array.isArray(d.rules) ? d.rules : [] };
  }

  async updateDictionary(
    id: number | string,
    input: { name?: string; rules?: AI33DictionaryRule[] }
  ): Promise<AI33Dictionary> {
    const data = await this.request(`/v3/dictionaries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    const d = data?.dictionary || data;
    return { id: Number(d.id), name: String(d.name || ''), rules: Array.isArray(d.rules) ? d.rules : [] };
  }

  async deleteDictionary(id: number | string): Promise<void> {
    await this.request(`/v3/dictionaries/${id}`, { method: 'DELETE' });
  }

  /** Preview a rule set against sample text without saving anything. */
  async previewDictionary(input: {
    text: string;
    rules: AI33DictionaryRule[];
  }): Promise<{ input: string; output: string }> {
    const data = await this.request('/v3/dictionaries/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { input: data?.input ?? input.text, output: data?.output ?? input.text };
  }
}

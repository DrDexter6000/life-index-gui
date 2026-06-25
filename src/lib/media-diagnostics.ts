export type MediaFailureLayer = 'backend' | 'tunnel' | 'browser' | 'network' | 'http' | 'unknown';

export interface MediaLoadDiagnostic {
  layer: MediaFailureLayer;
  status: number | null;
  url: string;
}

type MediaProbeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status'>>;

const TUNNEL_ORIGIN_STATUS = new Set([502, 503, 504, 522, 523, 524]);

export async function diagnoseMediaLoadFailure(
  url: string,
  fetchImpl: MediaProbeFetch | undefined = globalThis.fetch,
): Promise<MediaLoadDiagnostic> {
  if (!fetchImpl) {
    return { layer: 'unknown', status: null, url };
  }

  try {
    const response = await fetchImpl(url, { method: 'HEAD', cache: 'no-store' });
    if (response.ok) {
      return { layer: 'browser', status: response.status, url };
    }
    if (TUNNEL_ORIGIN_STATUS.has(response.status)) {
      return { layer: 'tunnel', status: response.status, url };
    }
    if (response.status >= 500) {
      return { layer: 'backend', status: response.status, url };
    }
    return { layer: 'http', status: response.status, url };
  } catch {
    return { layer: 'network', status: null, url };
  }
}

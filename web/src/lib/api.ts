export type JsonRecord = Record<string, any>;

export class ApiError extends Error {
  status: number;
  payload: JsonRecord;

  constructor(message: string, status: number, payload: JsonRecord = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function readJson(response: Response): Promise<JsonRecord> {
  try {
    return (await response.json()) as JsonRecord;
  } catch {
    return {};
  }
}

export async function getJson<T = JsonRecord>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await readJson(response);
  if (!response.ok) throw new ApiError(String(payload.error || response.statusText), response.status, payload);
  return payload as T;
}

export async function sendJson<T = JsonRecord>(url: string, body: unknown = {}, method = "POST"): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await readJson(response);
  if (!response.ok) throw new ApiError(String(payload.error || response.statusText), response.status, payload);
  return payload as T;
}

export function buildQuery(params: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "" || value === false) continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

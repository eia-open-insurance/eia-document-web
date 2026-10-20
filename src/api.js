export const TENANT = '11111111-1111-7111-8111-111111111111';
export const API_BASE = '/api/v1/documents';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function readError(response) {
  try {
    const body = await response.json();
    if (body && body.code) {
      return body.message ? `${body.code}: ${body.message}` : String(body.code);
    }
    if (body && (body.detail || body.message || body.title)) {
      return body.detail || body.message || body.title;
    }
  } catch (ignored) {
    // The API returns a JSON error envelope; fall back to the status otherwise.
  }
  return `Request failed with status ${response.status}`;
}

/**
 * Transport for the public Document API. The tenant is never part of a body;
 * it always travels in X-EIA-Tenant. A 204 response has no body.
 */
export async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: options.cache || 'no-store',
    headers: {
      'X-EIA-Tenant': TENANT,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new ApiError(await readError(response), response.status);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

export const api = {
  documents: {
    list: () => request(API_BASE),
    get: (documentId) => request(`${API_BASE}/${encodeURIComponent(documentId)}`),
    create: (body) => request(API_BASE, { method: 'POST', body: JSON.stringify(body) }),
    changeStatus: (documentId, status) =>
      request(`${API_BASE}/${encodeURIComponent(documentId)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status })
      })
  },
  links: {
    /**
     * Links are a document-owned projection. The document read does not carry
     * them, so the workbench reads the association collection after the record
     * itself has loaded.
     */
    list: (documentId) =>
      request(`${API_BASE}/${encodeURIComponent(documentId)}/links`),
    /**
     * Associates the document with one business record. The record stays owned
     * by its own vertical; only the document-side association is written.
     */
    create: (documentId, body) =>
      request(`${API_BASE}/${encodeURIComponent(documentId)}/links`, {
        method: 'POST',
        body: JSON.stringify(body)
      }),
    remove: (documentId, linkId) =>
      request(
        `${API_BASE}/${encodeURIComponent(documentId)}/links/${encodeURIComponent(linkId)}`,
        { method: 'DELETE' }
      )
  }
};

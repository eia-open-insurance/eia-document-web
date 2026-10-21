import { ACTIVITY_LIMIT, aggregateEventsEndpoint } from './events.js';
import {
  contentFileNameHeader,
  contentMimeType,
  fileNameFromContentDisposition
} from './documentContent.js';

export const TENANT = '11111111-1111-7111-8111-111111111111';
export const API_BASE = '/api/v1/documents';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Maps the API's JSON error envelope (or a bare status) to a message. */
function errorMessage(body, status) {
  if (body && typeof body === 'object') {
    if (body.code) {
      return body.message ? `${body.code}: ${body.message}` : String(body.code);
    }
    if (body.detail || body.message || body.title) {
      return body.detail || body.message || body.title;
    }
  }
  return `Request failed with status ${status}`;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readError(response) {
  try {
    return errorMessage(await response.json(), response.status);
  } catch (ignored) {
    // The API returns a JSON error envelope; fall back to the status otherwise.
    return `Request failed with status ${response.status}`;
  }
}

function contentPath(documentId, suffix = '') {
  return `${API_BASE}/${encodeURIComponent(documentId)}/content${suffix}`;
}

/** Reads an authorized binary representation and its suggested file name. */
async function downloadBlob(path) {
  const response = await fetch(path, {
    cache: 'no-store',
    headers: { 'X-EIA-Tenant': TENANT }
  });
  if (!response.ok) {
    throw new ApiError(await readError(response), response.status);
  }
  return {
    blob: await response.blob(),
    fileName: fileNameFromContentDisposition(response.headers.get('Content-Disposition'))
  };
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
      }),
    /**
     * Places a legal hold. The reason is the audit fact for the hold, so it is
     * always sent; a hold suspends disposition until it is explicitly released.
     */
    placeHold: (documentId, reason) =>
      request(`${API_BASE}/${encodeURIComponent(documentId)}/hold`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      }),
    /** Releases the active hold; the record returns to its pre-hold status. */
    releaseHold: (documentId) =>
      request(`${API_BASE}/${encodeURIComponent(documentId)}/hold/release`, {
        method: 'POST'
      }),
    /**
     * Irreversibly disposes the document. The content is destroyed; the record
     * tombstone, audit trail, and disposition certificate are retained.
     */
    dispose: (documentId) =>
      request(`${API_BASE}/${encodeURIComponent(documentId)}/dispose`, {
        method: 'POST'
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
  },
  content: {
    /**
     * Stored-content metadata for one document. A 404 means the document is
     * registered but no evidence file has been stored yet; that is an empty
     * state, not an error.
     */
    metadata: async (documentId) => {
      try {
        return await request(contentPath(documentId, '/metadata'));
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) return null;
        // A 200 with an empty body is still "unknown metadata", not a crash.
        if (cause instanceof SyntaxError) return null;
        throw cause;
      }
    },
    /**
     * Uploads the raw file bytes. The file name and media type travel in
     * headers because the body is the file itself, never a JSON envelope.
     * XMLHttpRequest is used so the caller can show byte-level progress.
     */
    upload: (documentId, file, { onProgress } = {}) =>
      new Promise((resolve, reject) => {
        if (typeof XMLHttpRequest === 'undefined') {
          reject(new ApiError('This environment cannot upload files.', 0));
          return;
        }

        const xhr = new XMLHttpRequest();
        xhr.open('PUT', contentPath(documentId));
        xhr.setRequestHeader('X-EIA-Tenant', TENANT);
        xhr.setRequestHeader('Content-Type', contentMimeType(file));
        xhr.setRequestHeader('X-File-Name', contentFileNameHeader(file.name));

        if (xhr.upload && typeof onProgress === 'function') {
          xhr.upload.onprogress = (event) => {
            const total = event.total || (file && file.size) || 0;
            if (total > 0) {
              onProgress(Math.min(100, Math.round((event.loaded / total) * 100)));
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            if (typeof onProgress === 'function') onProgress(100);
            resolve(xhr.status === 204 ? null : parseJson(xhr.responseText));
            return;
          }
          reject(new ApiError(errorMessage(parseJson(xhr.responseText), xhr.status), xhr.status));
        };
        xhr.onerror = () =>
          reject(new ApiError('The file could not be uploaded because the network request failed.', 0));
        xhr.onabort = () => reject(new ApiError('The file upload was cancelled.', 0));

        xhr.send(file);
      }),
    /** Reads the stored bytes as a blob for an authorized client download. */
    download: (documentId) => downloadBlob(contentPath(documentId)),
    /**
     * Immutable content revisions, newest first. The API returns a plain array
     * of revision metadata; an older deployment without the route, or a
     * document whose content predates revision history, reads as no history
     * rather than a failure.
     */
    versions: {
      list: async (documentId) => {
        try {
          return await request(contentPath(documentId, '/versions'));
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 404) return [];
          if (cause instanceof SyntaxError) return [];
          throw cause;
        }
      },
      /** Reads the bytes of one retained revision as a blob. */
      download: (documentId, version) =>
        downloadBlob(contentPath(documentId, `/versions/${encodeURIComponent(version)}`))
    }
  },
  events: {
    /**
     * The append-only activity stream for one document aggregate. The event
     * service is a separate platform service; a failure here is contained by
     * the caller and never blocks the document record.
     */
    aggregate: (documentId, limit = ACTIVITY_LIMIT) =>
      request(aggregateEventsEndpoint(documentId, limit))
  }
};

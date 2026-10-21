/**
 * Stored-content helpers for the Document remote.
 *
 * A document has one metadata record (the source of truth) and, optionally,
 * stored content: the evidence file itself. Content is uploaded as raw bytes
 * to `PUT /api/v1/documents/{id}/content` and read back as a blob from
 * `GET /api/v1/documents/{id}/content`. These helpers keep the client-side
 * rules (the 10 MiB ceiling), the metadata projection, and the download
 * mechanics in one place so the view stays declarative.
 */

/** The Document API's content ceiling; the backend enforces the same limit. */
export const MAX_CONTENT_BYTES = 10 * 1024 * 1024;
export const MAX_CONTENT_LABEL = '10 MiB';

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB'];

/** Formats a byte count with binary units, e.g. 1843200 -> "1.8 MiB". */
export function formatBytes(bytes) {
  const value = Number(bytes);
  if (bytes === null || bytes === undefined || bytes === '' || !Number.isFinite(value) || value < 0) {
    return '—';
  }
  if (value === 0) return '0 B';
  let unit = 0;
  let scaled = value;
  while (scaled >= 1024 && unit < BYTE_UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || scaled >= 10 ? 0 : 1;
  return `${scaled.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/**
 * Client-side validation for a file selected for upload. Returns an empty
 * string when the file is acceptable, or a message that can be shown inline.
 */
export function validateContentFile(file) {
  if (!file) return 'Choose a file to upload.';
  if (!file.size) {
    return `“${file.name}” is empty. Choose a non-empty file.`;
  }
  if (file.size > MAX_CONTENT_BYTES) {
    return `“${file.name}” is ${formatBytes(file.size)}. Files are limited to ${MAX_CONTENT_LABEL}.`;
  }
  return '';
}

/**
 * `X-File-Name` travels as an HTTP header. XHR header values are restricted to
 * ISO-8859-1, so a name outside printable ASCII is percent-encoded; the
 * backend decodes it. Header-unsafe characters are removed.
 */
export function contentFileNameHeader(fileName) {
  const clean = String(fileName || 'file').replace(/[\r\n"]/g, '_').trim() || 'file';
  return /^[\x20-\x7e]*$/.test(clean) ? clean : encodeURIComponent(clean);
}

export function contentMimeType(file) {
  return (file && file.type) || 'application/octet-stream';
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return '';
}

function normalizeSha256(value) {
  const text = String(value || '').trim();
  return text.replace(/^sha256:/i, '').trim();
}

/**
 * Folds the content-metadata projection into one shape used by the view. The
 * API owns the field names; aliases here are a compatibility seam for the
 * metadata case so a richer payload (e.g. `mimeType`/`size`) still renders.
 * Returns null when the document has no stored content.
 */
export function normalizeContentMetadata(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.exists === false || body.stored === false) return null;

  const record = body.content && typeof body.content === 'object' && !Array.isArray(body.content)
    ? body.content
    : body;

  const fileName = firstText(
    record.fileName,
    record.filename,
    record.file_name,
    record.originalFileName,
    record.originalFilename,
    record.originalName,
    record.original_name,
    record.name
  );
  const contentType = firstText(
    record.contentType,
    record.content_type,
    record.mimeType,
    record.mime_type,
    record.mediaType,
    record.type
  );
  const sizeBytes = firstNumber(
    record.sizeBytes,
    record.size_bytes,
    record.contentLength,
    record.content_length,
    record.byteSize,
    record.byte_size,
    record.size
  );
  const sha256 = normalizeSha256(firstValue(
    record.sha256,
    record.sha_256,
    record.contentSha256,
    record.content_sha256,
    record.checksumSha256,
    record.checksum_sha256,
    record.checksum,
    record.contentHash,
    record.hash
  ));
  const uploadedAt = firstText(
    record.uploadedAt,
    record.uploaded_at,
    record.storedAt,
    record.stored_at,
    record.createdAt
  );

  if (!fileName && sizeBytes === null && !sha256 && !uploadedAt) return null;
  // A zero-valued projection ("no file yet") is an empty state, not content.
  if (!fileName && !sha256 && !uploadedAt && sizeBytes === 0) return null;

  return {
    fileName,
    contentType,
    sizeBytes,
    sha256,
    uploadedAt
  };
}

/** Reads the file name from a Content-Disposition response header. */
export function fileNameFromContentDisposition(value) {
  if (!value) return '';
  const extended = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(value);
  if (extended) {
    const candidate = extended[1].trim().replace(/^"|"$/g, '');
    try {
      return decodeURIComponent(candidate);
    } catch {
      return candidate;
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(value);
  if (!plain) return '';
  return (plain[1] ?? plain[2] ?? '').trim();
}

/**
 * Saves a fetched blob through an object URL. The object URL is revoked after
 * the browser has had a chance to start the download.
 */
export function saveBlob(blob, fileName) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    throw new Error('This environment cannot download files.');
  }
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName || 'download';
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return objectUrl;
}

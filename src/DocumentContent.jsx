import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import {
  MAX_CONTENT_LABEL,
  formatBytes,
  isContentDeleted,
  markContentDeleted,
  normalizeContentMetadata,
  normalizeContentVersions,
  resolveCurrentContentVersion,
  saveBlob,
  shortSha256,
  validateContentFile
} from './documentContent.js';

const EMPTY_CONTENT = { loading: true, metadata: null, error: '' };
const EMPTY_VERSION_HISTORY = { loading: true, versions: [], currentVersion: null, error: '' };
const EMPTY_UPLOAD = { busy: false, progress: null, error: '', notice: '' };
const EMPTY_DOWNLOAD = { busy: false, error: '', notice: '' };
const EMPTY_VERSION_DOWNLOAD = { busy: null, error: '', notice: '' };
const EMPTY_DELETE = { open: false, busy: false, error: '' };

const DELETE_OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: 'rgba(11, 46, 79, 0.52)'
};

const DELETE_DIALOG_STYLE = {
  width: 'min(620px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

function formatUploadedAt(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Deletion timestamps and upload timestamps share a shape, but a date-only
 * value (some deployments truncate audit dates) must not shift a day when it
 * is parsed as an instant.
 */
function formatContentMoment(value) {
  if (!value) return '—';
  const raw = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : formatUploadedAt(raw);
}

function ProgressBar({ label, value }) {
  const percent = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      className="eia-upload-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      data-testid="upload-progress"
    >
      <div className="eia-progress-track">
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="eia-progress-label">
        {label}… {percent}%
      </span>
    </div>
  );
}

/**
 * The stored evidence file attached to one document. The document metadata
 * stays the source of truth; this panel reads, uploads, and downloads the
 * content the Document service stores beside that metadata. Every upload is
 * retained as an immutable version, and the panel lets a caller inspect and
 * download any revision without changing the current file.
 */
export default function DocumentContent({
  documentId,
  documentNumber,
  legalHold = false,
  legalHoldReason = '',
  onUploaded,
  onDeleted
}) {
  const [content, setContent] = useState(EMPTY_CONTENT);
  const [versionHistory, setVersionHistory] = useState(EMPTY_VERSION_HISTORY);
  const [reload, setReload] = useState(0);
  const [pendingFile, setPendingFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [upload, setUpload] = useState(EMPTY_UPLOAD);
  const [download, setDownload] = useState(EMPTY_DOWNLOAD);
  const [versionDownload, setVersionDownload] = useState(EMPTY_VERSION_DOWNLOAD);
  const [deletion, setDeletion] = useState(EMPTY_DELETE);
  const [deleteNotice, setDeleteNotice] = useState('');
  const [versionUploadOpen, setVersionUploadOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!deletion.open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !deletion.busy) {
        setDeletion(EMPTY_DELETE);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deletion.open, deletion.busy]);

  useEffect(() => {
    let alive = true;
    setContent((current) => ({ ...current, loading: true, error: '' }));
    setVersionHistory((current) => ({ ...current, loading: true, error: '' }));

    api.content
      .metadata(documentId)
      .then((body) => {
        if (!alive) return;
        setContent({ loading: false, metadata: normalizeContentMetadata(body), error: '' });
      })
      .catch((cause) => {
        if (!alive) return;
        setContent((current) => ({ loading: false, metadata: current.metadata, error: cause.message }));
      });

    api.content.versions
      .list(documentId)
      .then((body) => {
        if (!alive) return;
        const normalized = normalizeContentVersions(body);
        setVersionHistory({
          loading: false,
          versions: normalized.versions,
          currentVersion: normalized.currentVersion,
          error: ''
        });
      })
      .catch((cause) => {
        if (!alive) return;
        setVersionHistory((current) => ({ ...current, loading: false, error: cause.message }));
      });

    return () => {
      alive = false;
    };
  }, [documentId, reload]);

  const metadata = content.metadata;
  const deleted = isContentDeleted(metadata);
  const historyAvailable = !versionHistory.loading && !versionHistory.error;
  const currentVersion = resolveCurrentContentVersion(
    metadata,
    versionHistory.versions,
    versionHistory.currentVersion,
    { historyAvailable }
  );

  // Deletion is a destructive content command, not a document disposition.
  // The tombstone stays readable forever; each condition that disables the
  // command is explained beside the button.
  let deleteBlock = '';
  if (deleted) {
    deleteBlock =
      'The stored content has already been deleted. The bytes are gone; the file name, hash, size, and version audit remain as a tombstone.';
  } else if (legalHold) {
    deleteBlock = `Legal hold blocks content deletion.${
      legalHoldReason ? ` Hold reason: ${legalHoldReason}.` : ''
    } Release the hold before deleting this file.`;
  } else if (!metadata) {
    deleteBlock = 'No content is stored for this document, so there is nothing to delete.';
  }
  const canDeleteContent = !deleteBlock;

  function chooseFile(file) {
    if (!file) return;
    const issue = validateContentFile(file);
    if (issue) {
      setPendingFile(null);
      setFileError(issue);
      setUpload(EMPTY_UPLOAD);
      return;
    }
    setPendingFile(file);
    setFileError('');
    setUpload(EMPTY_UPLOAD);
  }

  function onInputChange(event) {
    const file = event.target.files && event.target.files[0];
    // Clearing the input lets the same file be selected again after a failure;
    // the File object itself is retained in component state.
    event.target.value = '';
    if (file) chooseFile(file);
  }

  function onDragOver(event) {
    event.preventDefault();
    if (!upload.busy) setDragging(true);
  }

  function onDragLeave(event) {
    event.preventDefault();
    setDragging(false);
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    if (upload.busy) return;
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) chooseFile(file);
  }

  async function uploadSelected() {
    if (!pendingFile || upload.busy) return;
    const file = pendingFile;
    setFileError('');
    setUpload({ busy: true, progress: 0, error: '', notice: '' });
    try {
      const uploaded = await api.content.upload(documentId, file, {
        onProgress: (progress) => {
          if (!mountedRef.current) return;
          setUpload((current) => (current.busy ? { ...current, progress } : current));
        }
      });
      if (!mountedRef.current) return;
      // The upload response is the new current metadata, so the version shown
      // beside the file updates before the history read completes. A 204 or
      // older response shape falls back to the reload below.
      const uploadedMetadata = normalizeContentMetadata(uploaded);
      if (uploadedMetadata) {
        setContent({ loading: false, metadata: uploadedMetadata, error: '' });
      }
      setPendingFile(null);
      setVersionUploadOpen(false);
      setVersionDownload(EMPTY_VERSION_DOWNLOAD);
      setUpload({
        busy: false,
        progress: 100,
        error: '',
        notice: `“${file.name}” was uploaded and stored as evidence.`
      });
      setReload((value) => value + 1);
      if (onUploaded) onUploaded();
    } catch (cause) {
      if (!mountedRef.current) return;
      setUpload({ busy: false, progress: null, error: cause.message, notice: '' });
    }
  }

  async function downloadFile() {
    if (download.busy || deleted) return;
    setDownload({ busy: true, error: '', notice: '' });
    try {
      const stored = await api.content.download(documentId);
      if (!mountedRef.current) return;
      const fileName =
        (metadata && metadata.fileName) ||
        stored.fileName ||
        `${documentNumber || 'document'}.bin`;
      saveBlob(stored.blob, fileName);
      setDownload({ busy: false, error: '', notice: `${fileName} downloaded.` });
    } catch (cause) {
      if (!mountedRef.current) return;
      if (cause.status === 410) {
        // The metadata this tab holds predates a deletion made elsewhere. 410
        // Gone is the API saying the bytes no longer exist, so the only
        // truthful state left is the tombstone.
        setContent((current) => ({
          ...current,
          loading: false,
          metadata: markContentDeleted(current.metadata)
        }));
        setDownload({
          busy: false,
          error: `The stored file is no longer available: its content was deleted. ${cause.message}`.trim(),
          notice: ''
        });
        return;
      }
      setDownload({ busy: false, error: cause.message, notice: '' });
    }
  }

  async function downloadVersion(version) {
    if (!version || versionDownload.busy !== null) return;
    const number = version.version;
    setVersionDownload({ busy: number, error: '', notice: '' });
    try {
      const stored = await api.content.versions.download(documentId, number);
      if (!mountedRef.current) return;
      const fileName =
        version.fileName || stored.fileName || `${documentNumber || 'document'}-v${number}.bin`;
      saveBlob(stored.blob, fileName);
      setVersionDownload({
        busy: null,
        error: '',
        notice: `Version ${number} (${fileName}) downloaded.`
      });
    } catch (cause) {
      if (!mountedRef.current) return;
      if (cause.status === 410) {
        setContent((current) => ({
          ...current,
          loading: false,
          metadata: markContentDeleted(current.metadata)
        }));
        setVersionDownload({
          busy: null,
          error: `Version ${number} is no longer available: its content was deleted. ${cause.message}`.trim(),
          notice: ''
        });
        return;
      }
      setVersionDownload({
        busy: null,
        error: `Version ${number} could not be downloaded: ${cause.message}`,
        notice: ''
      });
    }
  }

  function openDeleteDialog() {
    if (!canDeleteContent || deletion.busy) return;
    setDeletion({ open: true, busy: false, error: '' });
  }

  function closeDeleteDialog() {
    if (deletion.busy) return;
    setDeletion(EMPTY_DELETE);
  }

  async function confirmDelete() {
    if (!canDeleteContent || deletion.busy) return;
    const before = metadata;
    setDeletion({ open: true, busy: true, error: '' });
    try {
      const result = await api.content.remove(documentId);
      if (!mountedRef.current) return;

      // The delete response may be the tombstone, a sparse projection, or a
      // 204. Keep every audit fact already on screen and only fill from the
      // response when it actually carries the value.
      const returned = normalizeContentMetadata(result);
      const audit = { ...(before || {}) };
      if (returned) {
        for (const field of ['fileName', 'contentType', 'sha256', 'uploadedAt']) {
          if (returned[field]) audit[field] = returned[field];
        }
        if (returned.sizeBytes !== null && returned.sizeBytes !== undefined) {
          audit.sizeBytes = returned.sizeBytes;
        }
        if (returned.currentVersion) audit.currentVersion = returned.currentVersion;
      }
      setContent({
        loading: false,
        metadata: markContentDeleted(audit, returned && returned.deletedAt),
        error: ''
      });
      setUpload(EMPTY_UPLOAD);
      setPendingFile(null);
      setFileError('');
      setVersionUploadOpen(false);
      setDownload(EMPTY_DOWNLOAD);
      setVersionDownload(EMPTY_VERSION_DOWNLOAD);
      setDeletion(EMPTY_DELETE);
      setDeleteNotice(
        `Content deleted from ${documentNumber || 'the document'}. The stored bytes are gone; the file name, hash, size, and version history are retained as a tombstone.`
      );
      if (onDeleted) onDeleted();
    } catch (cause) {
      if (!mountedRef.current) return;
      setDeletion((current) => ({
        ...current,
        busy: false,
        error: `The content could not be deleted: ${cause.message}`
      }));
    }
  }

  function toggleVersionUpload() {
    if (upload.busy) return;
    const next = !versionUploadOpen;
    setVersionUploadOpen(next);
    if (!next) {
      setPendingFile(null);
      setFileError('');
      setUpload(EMPTY_UPLOAD);
    }
  }

  function renderProgress() {
    if (!upload.busy) return null;
    return <ProgressBar label={upload.progress === null ? 'Uploading' : 'Uploading file'} value={upload.progress} />;
  }

  function renderUploadErrors() {
    return (
      <>
        {fileError && (
          <p role="alert" data-testid="file-validation-error" style={{ margin: '10px 0 0' }}>
            {fileError}
          </p>
        )}
        {upload.error && (
          <p role="alert" data-testid="upload-error" style={{ margin: '10px 0 0' }}>
            {upload.error}
          </p>
        )}
        {upload.notice && (
          <p role="status" data-testid="upload-notice" style={{ margin: '10px 0 0' }}>
            {upload.notice}
          </p>
        )}
      </>
    );
  }

  function renderUploader({ newVersion = false } = {}) {
    const inputId = newVersion ? 'content-version-file-input' : 'content-file-input';
    const hintId = newVersion ? 'content-version-file-hint' : 'content-file-hint';
    return (
      <div
        className={`eia-dropzone ${dragging ? 'over' : ''}`.trim()}
        data-testid={newVersion ? 'version-file-dropzone' : 'file-dropzone'}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <label htmlFor={inputId}>{newVersion ? 'New version file' : 'File to upload'}</label>
        <input
          id={inputId}
          type="file"
          onChange={onInputChange}
          disabled={upload.busy}
          aria-describedby={hintId}
        />
        <p id={hintId} className="eia-muted" style={{ margin: '6px 0 0' }}>
          Drag a file here, or choose one. Maximum {MAX_CONTENT_LABEL}.
        </p>
        {pendingFile && (
          <p
            className="eia-file-selected"
            data-testid={newVersion ? 'version-selected-file' : 'selected-file'}
            style={{ margin: '8px 0 0' }}
          >
            Selected: <strong>{pendingFile.name}</strong>
            <span className="eia-muted"> · {formatBytes(pendingFile.size)}</span>
          </p>
        )}
        <div className="eia-actions" style={{ justifyContent: 'center', marginTop: 10 }}>
          <button type="button" onClick={uploadSelected} disabled={!pendingFile || upload.busy}>
            {upload.busy ? 'Uploading…' : newVersion ? 'Upload new version' : 'Upload file'}
          </button>
        </div>
        {renderProgress()}
      </div>
    );
  }

  function renderNoContent() {
    return (
      <div className="eia-card eia-content-empty" data-testid="no-content">
        <p style={{ marginTop: 0 }}>
          <strong>No file stored</strong>
        </p>
        <p style={{ marginTop: 4 }}>
          This document is registered evidence metadata, but the Document service holds no content
          file for it yet. Upload the file this record evidences ({MAX_CONTENT_LABEL} maximum). The
          document metadata stays authoritative.
        </p>

        {renderUploader()}
      </div>
    );
  }

  function renderMetadata(metadata) {
    const size = metadata.sizeBytes === null ? '—' : formatBytes(metadata.sizeBytes);
    return (
      <section className="eia-card" aria-label="Stored file" data-testid="file-metadata">
        <div className="eia-section-title" style={{ margin: '0 0 10px' }}>
          <h3 style={{ margin: 0 }}>Stored file</h3>
          <span className="eia-muted">Current file</span>
        </div>

        <dl className="eia-kv eia-file-meta">
          <dt>File name</dt>
          <dd data-testid="content-file-name">{metadata.fileName || '—'}</dd>
          <dt>Current version</dt>
          <dd data-testid="content-current-version">
            {currentVersion ? `v${currentVersion}` : '—'}
          </dd>
          <dt>Type</dt>
          <dd data-testid="content-file-type">{metadata.contentType || '—'}</dd>
          <dt>Size</dt>
          <dd data-testid="content-file-size">{size}</dd>
          <dt>SHA-256</dt>
          <dd
            className="eia-mono eia-content-hash"
            data-testid="content-file-sha256"
            title={metadata.sha256 || undefined}
          >
            {metadata.sha256 || '—'}
          </dd>
          <dt>Uploaded at</dt>
          <dd data-testid="content-file-uploaded">
            {metadata.uploadedAt ? (
              <time dateTime={metadata.uploadedAt}>{formatUploadedAt(metadata.uploadedAt)}</time>
            ) : (
              '—'
            )}
          </dd>
        </dl>

        <div className="eia-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
          <button
            type="button"
            onClick={downloadFile}
            disabled={download.busy}
            data-testid="download-content"
          >
            {download.busy ? 'Downloading…' : 'Download'}
          </button>
          <button
            type="button"
            className="eia-btn-secondary"
            onClick={toggleVersionUpload}
            disabled={upload.busy}
            aria-expanded={versionUploadOpen}
            data-testid="toggle-upload-version"
          >
            {versionUploadOpen ? 'Cancel new version' : 'Upload new version'}
          </button>
        </div>

        {versionUploadOpen && (
          <>
            <p className="eia-muted" style={{ margin: '10px 0 0' }}>
              Uploading replaces the current file and adds a new version. Earlier versions stay
              downloadable from the history below.
            </p>
            {renderUploader({ newVersion: true })}
          </>
        )}

        {download.error && (
          <p role="alert" data-testid="download-error" style={{ margin: '10px 0 0' }}>
            {download.error}
          </p>
        )}
        {download.notice && (
          <p role="status" data-testid="download-notice" style={{ margin: '10px 0 0' }}>
            {download.notice}
          </p>
        )}
      </section>
    );
  }

  /**
   * The tombstone left after the bytes are destroyed. It is deliberately
   * readable and separate from the empty state: the audit facts remain, but
   * there is nothing left to download or delete.
   */
  function renderDeleted(file) {
    const size = file.sizeBytes === null || file.sizeBytes === undefined
      ? '—'
      : formatBytes(file.sizeBytes);
    return (
      <section className="eia-card" aria-label="Deleted content" data-testid="content-deleted">
        <div className="eia-section-title" style={{ margin: '0 0 10px' }}>
          <h3 style={{ margin: 0 }}>Stored file</h3>
          <span className="eia-pill red" data-testid="content-deleted-badge">
            DELETED
          </span>
        </div>

        <div
          className="eia-context-panel"
          style={{ margin: '0 0 12px', borderLeftColor: 'var(--eia-red)' }}
          data-testid="content-deleted-warning"
        >
          <h4 style={{ color: 'var(--eia-red)' }}>Content deleted</h4>
          <p>
            The stored bytes were destroyed and cannot be downloaded or recovered. The tombstone
            below is retained for audit: the file name, hash, size, and version still identify the
            evidence that was deleted.
          </p>
        </div>

        <dl className="eia-kv eia-file-meta">
          <dt>File name</dt>
          <dd data-testid="content-file-name">{file.fileName || '—'}</dd>
          <dt>Current version</dt>
          <dd data-testid="content-current-version">
            {currentVersion ? `v${currentVersion}` : '—'}
          </dd>
          <dt>Type</dt>
          <dd data-testid="content-file-type">{file.contentType || '—'}</dd>
          <dt>Size</dt>
          <dd data-testid="content-file-size">{size}</dd>
          <dt>SHA-256</dt>
          <dd
            className="eia-mono eia-content-hash"
            data-testid="content-file-sha256"
            title={file.sha256 || undefined}
          >
            {file.sha256 || '—'}
          </dd>
          <dt>Uploaded at</dt>
          <dd data-testid="content-file-uploaded">
            {file.uploadedAt ? (
              <time dateTime={file.uploadedAt}>{formatUploadedAt(file.uploadedAt)}</time>
            ) : (
              '—'
            )}
          </dd>
          <dt>Deleted at</dt>
          <dd data-testid="content-deleted-at">
            {file.deletedAt ? (
              <time dateTime={file.deletedAt} title={file.deletedAt}>
                {formatContentMoment(file.deletedAt)}
              </time>
            ) : (
              '—'
            )}
          </dd>
        </dl>

        <div className="eia-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
          <button
            type="button"
            onClick={downloadFile}
            disabled
            title="Download is unavailable because the stored content was deleted."
            aria-describedby="content-deleted-download-reason"
            data-testid="download-content"
          >
            Download
          </button>
        </div>
        <p
          id="content-deleted-download-reason"
          className="eia-muted"
          data-testid="download-disabled-reason"
          style={{ margin: '10px 0 0' }}
        >
          Download is disabled: the content was deleted. The file name, hash, size, and version
          metadata remain available for audit.
        </p>

        {download.error && (
          <p role="alert" data-testid="download-error" style={{ margin: '10px 0 0' }}>
            {download.error}
          </p>
        )}
        {download.notice && (
          <p role="status" data-testid="download-notice" style={{ margin: '10px 0 0' }}>
            {download.notice}
          </p>
        )}
      </section>
    );
  }

  function renderDeleteAction() {
    return (
      <section
        className="eia-card"
        aria-label="Delete content"
        data-testid="delete-content-panel"
        style={{ marginTop: 14 }}
      >
        <div className="eia-section-title" style={{ margin: '0 0 10px' }}>
          <h3 style={{ margin: 0 }}>Delete content</h3>
          <span className="eia-muted">Irreversible</span>
        </div>
        <p className="eia-muted" style={{ margin: '0 0 10px' }}>
          Deleting the content permanently removes the stored bytes so they can no longer be
          downloaded. The document itself is not disposed: its file name, hash, size, and version
          audit remain as a tombstone. A legal hold blocks deletion.
        </p>

        <div className="eia-actions" style={{ justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="eia-btn-danger"
            onClick={openDeleteDialog}
            disabled={!canDeleteContent || deletion.busy}
            title={
              canDeleteContent
                ? 'Delete the stored content (confirmation required; this cannot be undone)'
                : deleteBlock
            }
            aria-describedby="content-delete-eligibility"
            data-testid="delete-content"
          >
            {deletion.busy ? 'Deleting…' : 'Delete content'}
          </button>
        </div>

        <p
          id="content-delete-eligibility"
          className="eia-muted"
          data-testid="delete-content-eligibility"
          style={{ margin: '10px 0 0' }}
        >
          {deleteBlock ||
            'The stored bytes will be destroyed; the file name, hash, size, and version audit are retained as a tombstone.'}
        </p>
      </section>
    );
  }

  function renderVersionHistory() {
    const { loading, error, versions } = versionHistory;
    return (
      <section
        className="eia-card"
        aria-label="Version history"
        data-testid="version-history"
        style={{ marginTop: 14 }}
      >
        <div className="eia-section-title" style={{ margin: '0 0 10px' }}>
          <h3 style={{ margin: 0 }}>Version history</h3>
          <span className="eia-muted" data-testid="version-count">
            {loading
              ? '…'
              : error
                ? 'Unavailable'
                : `${versions.length} version${versions.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <p className="eia-muted" style={{ margin: '0 0 10px' }}>
          {deleted
            ? 'Revision metadata is retained for audit. The revision bytes were deleted, so no version can be downloaded.'
            : 'Every upload is retained as an immutable revision. Downloading an older version never changes the current file.'}
        </p>

        {loading && (
          <p className="eia-muted" role="status" data-testid="version-history-loading">
            Loading version history…
          </p>
        )}

        {!loading && error && (
          <div className="eia-empty" data-testid="version-history-error">
            <p role="alert" style={{ marginTop: 0 }}>
              {error}
            </p>
            <button type="button" onClick={() => setReload((value) => value + 1)}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && versions.length === 0 && (
          <div className="eia-empty" data-testid="version-history-empty">
            <p style={{ marginTop: 0 }}>
              <strong>No version history yet</strong>
            </p>
            <p style={{ marginBottom: 0 }}>
              {currentVersion
                ? `The current file is version ${currentVersion}. `
                : 'The current file is not versioned yet. '}
              Files stored before version history existed appear as version 1; each new upload adds
              an entry here.
            </p>
          </div>
        )}

        {!loading && !error && versions.length > 0 && (
          <div className="eia-table-wrap">
            <table
              className="eia-table"
              aria-label="File version history"
              data-testid="version-history-table"
            >
              <thead>
                <tr>
                  <th>Version</th>
                  <th>File name</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>SHA-256</th>
                  <th>Uploaded</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => {
                  const isCurrent = version.version === currentVersion;
                  return (
                    <tr
                      key={version.version}
                      data-testid="version-row"
                      data-current={isCurrent ? 'true' : undefined}
                    >
                      <td>
                        <span className="eia-mono" data-testid="version-number">
                          {`v${version.version}`}
                        </span>
                        {isCurrent && (
                          <span
                            className="eia-pill blue"
                            style={{ marginLeft: 6 }}
                            data-testid="version-current-badge"
                          >
                            Current
                          </span>
                        )}
                      </td>
                      <td data-testid="version-file-name">{version.fileName || '—'}</td>
                      <td data-testid="version-file-type">{version.contentType || '—'}</td>
                      <td data-testid="version-file-size">{formatBytes(version.sizeBytes)}</td>
                      <td
                        className="eia-mono"
                        data-testid="version-sha256"
                        title={version.sha256 || undefined}
                      >
                        {shortSha256(version.sha256)}
                      </td>
                      <td data-testid="version-uploaded">
                        <time dateTime={version.uploadedAt || undefined}>
                          {formatUploadedAt(version.uploadedAt)}
                        </time>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="eia-btn-secondary"
                          onClick={() => downloadVersion(version)}
                          disabled={versionDownload.busy !== null || deleted}
                          title={
                            deleted
                              ? 'Version bytes were deleted; only the revision metadata is retained.'
                              : undefined
                          }
                          aria-label={`Download version ${version.version}`}
                          data-testid="download-version"
                        >
                          {versionDownload.busy === version.version ? 'Downloading…' : 'Download'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {versionDownload.error && (
          <p role="alert" data-testid="version-download-error" style={{ margin: '10px 0 0' }}>
            {versionDownload.error}
          </p>
        )}
        {versionDownload.notice && (
          <p role="status" data-testid="version-download-notice" style={{ margin: '10px 0 0' }}>
            {versionDownload.notice}
          </p>
        )}
      </section>
    );
  }

  return (
    <>
      <div className="eia-section-title">
        <h2>File</h2>
        <span className="eia-muted">Evidence content stored by the Document service</span>
      </div>

      <section className="eia-context-panel" aria-label="File context" data-testid="file-context">
        <h4>Why this matters</h4>
        <p>
          The stored file is evidence. Document metadata — number, type, classification, retention,
          and lifecycle — remains the source of truth; uploading, downloading, or deleting a file
          never changes the business facts the document evidences or the records it is linked to.
          Each upload is retained as a version so an earlier file can be produced without altering
          the record. Deleting the content destroys its bytes permanently while the file name, hash,
          size, and version audit remain as a tombstone; a legal hold blocks deletion.
        </p>
      </section>

      {deleteNotice && (
        <p
          role="status"
          data-testid="delete-notice"
          style={{ margin: '14px 0 0' }}
        >
          {deleteNotice}
        </p>
      )}

      <div style={{ marginTop: 14 }}>
        {content.loading && !content.metadata && (
          <p className="eia-muted" role="status" style={{ margin: '0 0 10px' }}>
            Loading file metadata…
          </p>
        )}

        {!content.loading && content.error && (
          <div className="eia-empty" data-testid="content-metadata-error">
            <p role="alert" style={{ marginTop: 0 }}>
              {content.error}
            </p>
            <button type="button" onClick={() => setReload((value) => value + 1)}>
              Retry
            </button>
          </div>
        )}

        {!content.error && metadata && !deleted && renderMetadata(metadata)}
        {!content.error && metadata && deleted && renderDeleted(metadata)}
        {!content.error && (metadata || !content.loading) && renderDeleteAction()}
        {!content.error && metadata && renderVersionHistory()}
        {!content.error && !metadata && !content.loading && renderNoContent()}
        {renderUploadErrors()}
      </div>

      {deletion.open && (
        <div
          style={DELETE_OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletion.busy) closeDeleteDialog();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-content-title"
            className="eia-card"
            style={DELETE_DIALOG_STYLE}
            data-testid="delete-content-dialog"
          >
            <div className="eia-record-title">
              <div>
                <h2 id="delete-content-title" style={{ margin: 0 }}>Delete content</h2>
                <p className="eia-record-subtitle">
                  Permanently delete the stored evidence file for{' '}
                  {documentNumber || 'this document'}. This cannot be undone.
                </p>
              </div>
              <button
                type="button"
                className="eia-btn-ghost"
                onClick={closeDeleteDialog}
                disabled={deletion.busy}
              >
                Close
              </button>
            </div>

            <div
              className="eia-context-panel"
              style={{ marginTop: 16, borderLeftColor: 'var(--eia-red)' }}
              data-testid="delete-content-warning"
            >
              <h4 style={{ color: 'var(--eia-red)' }}>Content deletion is irreversible</h4>
              <p>
                The stored bytes are destroyed permanently and cannot be recovered or downloaded.
                The file name, hash, size, and version audit are retained as a tombstone; the
                document record, links, and business facts are unchanged. A legal hold blocks
                deletion.
              </p>
            </div>

            <dl className="eia-kv" style={{ marginTop: 16 }}>
              <dt>File name</dt>
              <dd data-testid="delete-file-name">{metadata?.fileName || '—'}</dd>
              <dt>Current version</dt>
              <dd>{currentVersion ? `v${currentVersion}` : '—'}</dd>
              <dt>Size</dt>
              <dd>{metadata?.sizeBytes === null || metadata?.sizeBytes === undefined
                ? '—'
                : formatBytes(metadata.sizeBytes)}</dd>
              <dt>SHA-256</dt>
              <dd className="eia-mono eia-content-hash" title={metadata?.sha256 || undefined}>
                {metadata?.sha256 || '—'}
              </dd>
            </dl>

            <div className="eia-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="eia-btn-secondary"
                onClick={closeDeleteDialog}
                disabled={deletion.busy}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="eia-btn-danger"
                onClick={confirmDelete}
                disabled={deletion.busy}
                data-testid="confirm-delete-content"
              >
                {deletion.busy ? 'Deleting…' : 'Delete content'}
              </button>
            </div>

            {deletion.error && (
              <p role="alert" data-testid="delete-content-error" style={{ margin: '10px 0 0' }}>
                {deletion.error}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}

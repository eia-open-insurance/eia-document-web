import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import {
  MAX_CONTENT_LABEL,
  formatBytes,
  normalizeContentMetadata,
  saveBlob,
  validateContentFile
} from './documentContent.js';

const EMPTY_CONTENT = { loading: true, metadata: null, error: '' };
const EMPTY_UPLOAD = { busy: false, progress: null, error: '', notice: '' };
const EMPTY_DOWNLOAD = { busy: false, error: '', notice: '' };

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
 * stays the source of truth; this panel only reads, uploads, and downloads the
 * content the Document service stores beside that metadata.
 */
export default function DocumentContent({ documentId, documentNumber, onUploaded }) {
  const [content, setContent] = useState(EMPTY_CONTENT);
  const [reload, setReload] = useState(0);
  const [pendingFile, setPendingFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [upload, setUpload] = useState(EMPTY_UPLOAD);
  const [download, setDownload] = useState(EMPTY_DOWNLOAD);
  const [dragging, setDragging] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setContent((current) => ({ ...current, loading: true, error: '' }));
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
    return () => {
      alive = false;
    };
  }, [documentId, reload]);

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
      await api.content.upload(documentId, file, {
        onProgress: (progress) => {
          if (!mountedRef.current) return;
          setUpload((current) => (current.busy ? { ...current, progress } : current));
        }
      });
      if (!mountedRef.current) return;
      setPendingFile(null);
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
    if (download.busy) return;
    setDownload({ busy: true, error: '', notice: '' });
    try {
      const stored = await api.content.download(documentId);
      if (!mountedRef.current) return;
      const fileName =
        (content.metadata && content.metadata.fileName) ||
        stored.fileName ||
        `${documentNumber || 'document'}.bin`;
      saveBlob(stored.blob, fileName);
      setDownload({ busy: false, error: '', notice: `${fileName} downloaded.` });
    } catch (cause) {
      if (!mountedRef.current) return;
      setDownload({ busy: false, error: cause.message, notice: '' });
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

        <div
          className={`eia-dropzone ${dragging ? 'over' : ''}`.trim()}
          data-testid="file-dropzone"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <label htmlFor="content-file-input">File to upload</label>
          <input
            id="content-file-input"
            type="file"
            onChange={onInputChange}
            disabled={upload.busy}
            aria-describedby="content-file-hint"
          />
          <p id="content-file-hint" className="eia-muted" style={{ margin: '6px 0 0' }}>
            Drag a file here, or choose one. Maximum {MAX_CONTENT_LABEL}.
          </p>
          {pendingFile && (
            <p className="eia-file-selected" data-testid="selected-file" style={{ margin: '8px 0 0' }}>
              Selected: <strong>{pendingFile.name}</strong>
              <span className="eia-muted"> · {formatBytes(pendingFile.size)}</span>
            </p>
          )}
          <div className="eia-actions" style={{ justifyContent: 'center', marginTop: 10 }}>
            <button type="button" onClick={uploadSelected} disabled={!pendingFile || upload.busy}>
              {upload.busy ? 'Uploading…' : 'Upload file'}
            </button>
          </div>
          {renderProgress()}
        </div>
      </div>
    );
  }

  function renderMetadata(metadata) {
    const size = metadata.sizeBytes === null ? '—' : formatBytes(metadata.sizeBytes);
    return (
      <section className="eia-card" aria-label="Stored file" data-testid="file-metadata">
        <div className="eia-section-title" style={{ margin: '0 0 10px' }}>
          <h3 style={{ margin: 0 }}>Stored file</h3>
          <span className="eia-muted">Immutable content</span>
        </div>

        <dl className="eia-kv eia-file-meta">
          <dt>File name</dt>
          <dd data-testid="content-file-name">{metadata.fileName || '—'}</dd>
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
        </div>

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
          and lifecycle — remains the source of truth; uploading or downloading a file never changes
          the business facts the document evidences or the records it is linked to.
        </p>
      </section>

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

        {!content.error && content.metadata && renderMetadata(content.metadata)}
        {!content.error && !content.metadata && !content.loading && renderNoContent()}
        {renderUploadErrors()}
      </div>
    </>
  );
}

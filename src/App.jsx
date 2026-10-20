import React, { useEffect, useRef, useState } from 'react';
import './ui.css';
import { navigate, recordHref } from './navigation.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const API_BASE = '/api/v1/documents';

// SPEC 11.6.5 DocumentType.
const DOCUMENT_TYPES = [
  'POLICY', 'DECLARATIONS', 'ENDORSEMENT', 'CERTIFICATE', 'BINDER', 'QUOTE', 'SLIP', 'WORDING',
  'FORM', 'EXCLUSION', 'SCHEDULE', 'ASSUMED_CONTRACT', 'TREATY_SLIP', 'BORDEREAU', 'LOSS_ADVICE',
  'TECHNICAL_ACCOUNT', 'STATEMENT', 'CASH_CALL', 'SECURITY', 'COMMUTATION_AGREEMENT', 'CLAIM_FORM',
  'FNOL', 'PROOF_OF_LOSS', 'PLAINTIFF_FACT_SHEET', 'MEDICAL_RECORD', 'MEDICAL_BILL', 'B_READ',
  'EXPOSURE_AFFIDAVIT', 'AUTHORIZATION', 'HIPAA_RELEASE', 'DEMAND_LETTER', 'PLEADING', 'DISCOVERY',
  'DEPOSITION', 'EXPERT_REPORT', 'SETTLEMENT_AGREEMENT', 'RELEASE', 'CONSENT_JUDGMENT', 'COURT_ORDER',
  'LIEN', 'LIEN_WAIVER', 'MEDICARE_CONDITIONAL_PAYMENT', 'TRUST_CLAIM_FORM', 'TRUST_DISTRIBUTION',
  'PAYMENT_AUTHORITY', 'PAYMENT_RECEIPT', 'REMITTANCE', 'INVOICE', 'DEFENSE_INVOICE', 'TAX_FORM',
  'W9', 'KYC', 'SANCTIONS_RESULT', 'CORRESPONDENCE', 'EMAIL', 'NOTE', 'PHOTO', 'AUDIO', 'VIDEO', 'OTHER'
];

// SPEC 11.6.5 Confidentiality.
const CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'PHI', 'PRIVILEGED'];

// SPEC 11.6.6 lifecycle edges; the Document domain enforces the same map.
const NEXT_STATUSES = {
  PENDING_UPLOAD: ['RECEIVED'],
  RECEIVED: ['SCANNING'],
  SCANNING: ['PROCESSING', 'REJECTED'],
  PROCESSING: ['CLASSIFIED', 'FAILED'],
  CLASSIFIED: ['ACTIVE'],
  ACTIVE: ['SUPERSEDED', 'ON_HOLD', 'ARCHIVED', 'DISPOSED'],
  ON_HOLD: ['ACTIVE'],
  ARCHIVED: ['DISPOSED', 'ON_HOLD'],
  FAILED: ['PROCESSING'],
  SUPERSEDED: [],
  DISPOSED: [],
  REJECTED: []
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'lifecycle', label: 'Lifecycle' },
  { id: 'retention', label: 'Retention' },
  { id: 'associations', label: 'Associations' }
];

const EMPTY_FORM = { title: '', documentType: 'POLICY', classification: 'INTERNAL', retentionUntil: '' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readUrlState() {
  if (typeof window === 'undefined') return { record: '', create: false };
  const params = new URLSearchParams(window.location.search);
  return { record: params.get('record') || '', create: params.get('new') === '1' };
}

/**
 * The remote is mounted either at the shell route (/document) or directly at
 * the dev-server root (/). Only treat the URL as document state on those
 * routes so a future cross-link to /party or /policy is not read as a record.
 */
function onDocumentRoute() {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' || path === '/' || path.endsWith('/document');
}

/**
 * Keeps the address bar in step with the selected document and the register
 * dialog. `notify: false` leaves routing to the shell; the workbench already
 * applied the same state locally.
 */
function writeUrl({ record = '', create = false, replace = false } = {}) {
  if (typeof window === 'undefined' || !onDocumentRoute()) return;
  const base = recordHref(window.location.pathname || '/', record);
  const target = create ? `${base}${record ? '&' : '?'}new=1` : base;
  if (target === `${window.location.pathname}${window.location.search}`) return;
  navigate(target, { replace, notify: false });
}

function humanize(value) {
  return String(value || '').replace(/_/g, ' ');
}

function filterDocuments(documents, filter) {
  const term = filter.trim().toLowerCase();
  if (!term) return documents;
  return documents.filter((document) =>
    [
      document.documentNumber,
      document.title,
      document.documentType,
      humanize(document.documentType),
      document.status
    ].some((value) => String(value || '').toLowerCase().includes(term))
  );
}

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: 'rgba(11, 46, 79, 0.52)'
};

const DIALOG_STYLE = {
  width: 'min(760px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

const api = {
  documents: {
    list: () => request(API_BASE),
    get: (documentId) => request(`${API_BASE}/${documentId}`),
    create: (body) => request(API_BASE, { method: 'POST', body: JSON.stringify(body) }),
    changeStatus: (documentId, status) =>
      request(`${API_BASE}/${documentId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status })
      })
  }
};

async function readError(response) {
  try {
    const body = await response.json();
    if (body && body.code) {
      return `${body.code}: ${body.message}`;
    }
    if (body && (body.detail || body.message)) {
      return body.detail || body.message;
    }
  } catch (ignored) {
    // The API returns a JSON error envelope; fall back to the status otherwise.
  }
  return `Request failed with status ${response.status}`;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'X-EIA-Tenant': TENANT,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function statusTone(status) {
  if (status === 'ACTIVE') return 'green';
  if (['REJECTED', 'FAILED'].includes(status)) return 'red';
  if (status === 'ON_HOLD') return 'amber';
  return 'blue';
}

function classificationTone(classification) {
  if (classification === 'PUBLIC') return 'ok';
  if (['CONFIDENTIAL', 'RESTRICTED', 'PHI', 'PRIVILEGED'].includes(classification)) return 'warn';
  return '';
}

function formatTimestamp(value) {
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

function shortId(value) {
  if (!value) return '—';
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 8)}…` : text;
}

function StatusPill({ status }) {
  return <span className={`eia-pill ${statusTone(status)}`}>{status}</span>;
}

function Field({ label, htmlFor, className = '', children }) {
  return (
    <div className={`eia-field ${className}`.trim()}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailNonce, setDetailNonce] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [statusTargets, setStatusTargets] = useState({});
  const [statusBusy, setStatusBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [queueFilter, setQueueFilter] = useState('');

  const documentsRef = useRef([]);
  const registerOpenRef = useRef(false);
  const applyingUrlRef = useRef(false);

  const selectedDocument = documents.find((document) => document.id === selectedId) || null;
  const filteredDocuments = filterDocuments(documents, queueFilter);

  async function load() {
    const rows = await api.documents.list();
    const list = Array.isArray(rows) ? rows : [];
    setDocuments(list);
    return list;
  }

  /**
   * Applies ?record= and ?new=1. A record that is not in the queue is fetched
   * by id so a global-search link can open a document the list does not hold.
   */
  async function applyUrlState(rows, { initial = false } = {}) {
    if (!onDocumentRoute()) return;
    const { record, create } = readUrlState();

    if (create) {
      if (!registerOpenRef.current) setForm(EMPTY_FORM);
      setRegisterOpen(true);
      setError('');
      return;
    }

    if (!record) {
      if (!initial) {
        setRegisterOpen(false);
        setError('');
      }
      return;
    }

    setRegisterOpen(false);
    if (applyingUrlRef.current) return;

    const queue = Array.isArray(rows) && rows.length > 0 ? rows : documentsRef.current;
    const known = queue.find(
      (document) => document.id === record || document.documentNumber === record
    );
    if (known) {
      setSelectedId(known.id);
      setError('');
      return;
    }

    if (!UUID_PATTERN.test(record)) {
      setError(`Document “${record}” was not found in the document queue.`);
      return;
    }

    applyingUrlRef.current = true;
    try {
      const document = await api.documents.get(record);
      if (document?.id) {
        setDocuments((current) =>
          current.some((row) => row.id === document.id) ? current : [document, ...current]
        );
        setSelectedId(document.id);
        setActiveTab('overview');
        setError('');
      }
    } catch (cause) {
      setError(`Document ${record} could not be loaded: ${cause.message}`);
      setSelectedId((current) => current || documentsRef.current[0]?.id || null);
    } finally {
      applyingUrlRef.current = false;
    }
  }

  useEffect(() => {
    registerOpenRef.current = registerOpen;
  }, [registerOpen]);

  useEffect(() => {
    let alive = true;
    if (onDocumentRoute() && readUrlState().create) {
      setForm(EMPTY_FORM);
      setRegisterOpen(true);
    }

    const onPopState = () => {
      applyUrlState(documentsRef.current);
    };
    window.addEventListener('popstate', onPopState);

    load()
      .then((rows) => {
        if (!alive) return;
        setLoading(false);
        applyUrlState(rows, { initial: true });
      })
      .catch((cause) => {
        if (!alive) return;
        setLoading(false);
        setError(cause.message);
      });

    return () => {
      alive = false;
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    documentsRef.current = documents;
    setSelectedId((current) => {
      if (current && documents.some((document) => document.id === current)) return current;

      const requested = readUrlState().record;
      if (requested && onDocumentRoute()) {
        const match = documents.find(
          (document) => document.id === requested || document.documentNumber === requested
        );
        if (match) return match.id;
        // The detail lookup owns unknown UUIDs; keep the previous selection
        // instead of jumping to the first row while it is in flight.
        if (UUID_PATTERN.test(requested)) return current;
      }

      return documents[0]?.id || null;
    });
  }, [documents]);

  useEffect(() => {
    if (!selectedId) {
      setDetailLoading(false);
      return undefined;
    }

    let alive = true;
    setDetailLoading(true);
    api.documents
      .get(selectedId)
      .then((record) => {
        if (!alive || !record || !record.id) return;
        setDocuments((current) => {
          if (current.some((document) => document.id === record.id)) {
            return current.map((document) =>
              document.id === record.id ? { ...document, ...record } : document
            );
          }
          return [record, ...current];
        });
      })
      .catch((cause) => {
        if (alive) setError(cause.message);
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [selectedId, detailNonce]);

  useEffect(() => {
    if (!registerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !registerBusy) {
        setRegisterOpen(false);
        setError('');
        writeUrl({ record: selectedId || '' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [registerOpen, registerBusy, selectedId]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function refresh() {
    setError('');
    try {
      await load();
      if (selectedId) setDetailNonce((value) => value + 1);
    } catch (cause) {
      setError(cause.message);
    }
  }

  function selectDocument(document) {
    if (document.id !== selectedId) setActiveTab('overview');
    setSelectedId(document.id);
    setError('');
    setNotice('');
    writeUrl({ record: document.id });
  }

  function openRegister() {
    setForm(EMPTY_FORM);
    setError('');
    setRegisterOpen(true);
    writeUrl({ record: selectedId || '', create: true });
  }

  function closeRegister() {
    if (registerBusy) return;
    setRegisterOpen(false);
    setError('');
    writeUrl({ record: selectedId || '' });
  }

  async function submit(event) {
    event.preventDefault();
    setRegisterBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await api.documents.create({
        title: form.title,
        documentType: form.documentType,
        classification: form.classification,
        retentionUntil: form.retentionUntil || null
      });
      setForm(EMPTY_FORM);
      setRegisterOpen(false);
      if (created?.id) {
        setSelectedId(created.id);
        setDocuments((current) => {
          if (current.some((document) => document.id === created.id)) {
            return current.map((document) =>
              document.id === created.id ? { ...document, ...created } : document
            );
          }
          return [created, ...current];
        });
        writeUrl({ record: created.id });
      } else {
        writeUrl({ record: selectedId || '' });
      }
      setActiveTab('overview');
      setNotice('Document registered.');
      try {
        await load();
      } catch (cause) {
        setError(cause.message);
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setRegisterBusy(false);
    }
  }

  async function submitStatus(event) {
    event.preventDefault();
    if (!selectedDocument) return;

    const targets = NEXT_STATUSES[selectedDocument.status] || [];
    const chosen = statusTargets[selectedDocument.id];
    const target = targets.includes(chosen) ? chosen : targets[0];
    if (!target) return;

    setStatusBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api.documents.changeStatus(selectedDocument.id, target);
      if (updated?.id) {
        setDocuments((current) =>
          current.map((document) =>
            document.id === updated.id ? { ...document, ...updated } : document
          )
        );
      } else {
        await load();
      }
      setNotice(`${selectedDocument.documentNumber} moved to ${target}.`);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setStatusBusy(false);
    }
  }

  function renderOverview(document) {
    return (
      <>
        <div className="eia-grid eia-grid-2">
          <section className="eia-card" aria-label="Document details">
            <h3>Document details</h3>
            <dl className="eia-kv" style={{ marginTop: 8 }}>
              <dt>Document number</dt>
              <dd className="eia-mono">{document.documentNumber}</dd>
              <dt>Title</dt>
              <dd>{document.title}</dd>
              <dt>Document type</dt>
              <dd>{document.documentType}</dd>
              <dt>Classification</dt>
              <dd>{document.classification}</dd>
              <dt>Status</dt>
              <dd><StatusPill status={document.status} /></dd>
              <dt>Version</dt>
              <dd>{document.version ?? '—'}</dd>
            </dl>
          </section>

          <section className="eia-card" aria-label="Record state">
            <h3>Record state</h3>
            <dl className="eia-kv" style={{ marginTop: 8 }}>
              <dt>Record ID</dt>
              <dd className="eia-mono" title={document.id}>{shortId(document.id)}</dd>
              <dt>Registered</dt>
              <dd>{formatTimestamp(document.createdAt)}</dd>
              <dt>Last updated</dt>
              <dd>{formatTimestamp(document.updatedAt)}</dd>
              <dt>Retention until</dt>
              <dd>{document.retentionUntil || 'Not set'}</dd>
            </dl>
            <p className="eia-muted" style={{ margin: '12px 0 0' }}>
              Documents are evidence, not business facts. Business facts stay with the owning vertical.
            </p>
          </section>
        </div>

        <section
          className="eia-context-panel"
          aria-label="Why this matters"
          data-testid="why-this-matters"
        >
          <h4>Why this matters</h4>
          <p>
            Documents are evidence, not business facts. They reference records in other verticals and
            never mutate them — a policy, claim, payment, or party stays owned by its vertical, which
            remains the source of truth for every business fact the document evidences.
          </p>
        </section>

        <section
          className="eia-card"
          id="related-records"
          aria-label="Related records"
          data-testid="related-records"
          style={{ marginTop: 14 }}
        >
          <h3>Related records</h3>
          <p className="eia-muted" style={{ marginTop: 4 }}>
            Related records would link this document to the policies, claims, payments, and parties it
            evidences. This workbench lists only associations the Document API returns.
          </p>
          <div className="eia-empty" data-testid="related-records-empty" style={{ marginTop: 10 }}>
            <p style={{ marginTop: 0 }}>
              <strong>No related records are available yet.</strong>
            </p>
            <p style={{ marginBottom: 0 }}>
              Document associations are not yet exposed by this API, so none can be listed here. The
              workbench does not invent links to other verticals; the document’s metadata and lifecycle
              are the only references it can show.
            </p>
          </div>
        </section>
      </>
    );
  }

  function renderLifecycle(document) {
    const targets = NEXT_STATUSES[document.status] || [];
    const chosen = statusTargets[document.id];
    const selectedTarget = targets.includes(chosen) ? chosen : targets[0] || '';

    return (
      <>
        <div className="eia-section-title">
          <h2>Lifecycle</h2>
          <span className="eia-muted">Version {document.version ?? '—'}</span>
        </div>

        <div className="eia-grid eia-grid-2">
          <section className="eia-card" aria-label="Current lifecycle state">
            <h3>Current state</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <StatusPill status={document.status} />
              <span className="eia-muted">
                {targets.length === 0
                  ? 'Terminal state'
                  : `${targets.length} permitted transition${targets.length === 1 ? '' : 's'}`}
              </span>
            </div>
            <p className="eia-muted" style={{ margin: '10px 0 0' }}>
              Status changes follow SPEC 11.6.6. The Document domain rejects any transition outside the
              lifecycle.
            </p>
            {!document.retentionUntil && (
              <p className="eia-muted" style={{ margin: '8px 0 0' }}>
                A retention date is required before this document can become ACTIVE (DOC-05).
              </p>
            )}
          </section>

          <section className="eia-card" aria-label="Advance lifecycle state">
            <h3>Advance status</h3>
            {targets.length === 0 ? (
              <p className="eia-muted" style={{ margin: '10px 0 0' }}>
                {document.status} is a terminal state. No further lifecycle transitions are defined.
              </p>
            ) : (
              <form
                className="eia-form-grid"
                aria-label="Advance document status"
                onSubmit={submitStatus}
                style={{ marginTop: 10 }}
              >
                <Field label="Next status" htmlFor="next-status" className="span-2">
                  <select
                    id="next-status"
                    value={selectedTarget}
                    onChange={(event) =>
                      setStatusTargets((current) => ({
                        ...current,
                        [document.id]: event.target.value
                      }))
                    }
                    disabled={statusBusy}
                  >
                    {targets.map((target) => (
                      <option key={target} value={target}>{target}</option>
                    ))}
                  </select>
                </Field>
                <div className="eia-actions">
                  <button type="submit" disabled={statusBusy || !selectedTarget}>
                    {statusBusy ? 'Applying…' : 'Apply status'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>

        <div className="eia-section-title">
          <h2>Permitted transitions</h2>
          <span className="eia-muted">{targets.length}</span>
        </div>
        <div className="eia-table-wrap">
          <table className="eia-table" aria-label="Permitted lifecycle transitions">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Requirement</th>
              </tr>
            </thead>
            <tbody>
              {targets.length === 0 && (
                <tr>
                  <td colSpan={3} className="eia-muted">
                    No transitions are defined from {document.status}.
                  </td>
                </tr>
              )}
              {targets.map((target) => (
                <tr key={target}>
                  <td>{document.status}</td>
                  <td>{target}</td>
                  <td>{target === 'ACTIVE' ? 'Retention date required (DOC-05)' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function renderRetention(document) {
    return (
      <>
        <div className="eia-section-title">
          <h2>Retention</h2>
          <span className="eia-muted">{document.retentionUntil ? 'Scheduled' : 'Not set'}</span>
        </div>

        <div className="eia-grid eia-grid-2">
          <section className="eia-card" aria-label="Retention date">
            <h3>Retention until</h3>
            <div
              className="value"
              data-testid="retention-value"
              style={{ margin: '4px 0' }}
            >
              {document.retentionUntil || 'Not set'}
            </div>
            <div className="eia-metric-label">Earliest disposition date</div>
          </section>

          <section className="eia-card" aria-label="Retention record">
            <h3>Retention record</h3>
            <dl className="eia-kv" style={{ marginTop: 8 }}>
              <dt>Registered</dt>
              <dd>{formatTimestamp(document.createdAt)}</dd>
              <dt>Last updated</dt>
              <dd>{formatTimestamp(document.updatedAt)}</dd>
              <dt>Version</dt>
              <dd>{document.version ?? '—'}</dd>
            </dl>
          </section>
        </div>

        {!document.retentionUntil && (
          <div className="eia-empty" style={{ marginTop: 14 }}>
            No retention date is recorded. A retention date must be set before the document can become
            ACTIVE (DOC-05).
          </div>
        )}

        <p className="eia-muted" style={{ marginTop: 14 }}>
          Retention policy assignment, legal holds, and disposition are governed by the Document domain
          and are not exposed by the Document API in this build. This record shows the retention date the
          API returns.
        </p>
      </>
    );
  }

  function renderAssociations(document) {
    return (
      <>
        <div className="eia-section-title">
          <h2>Associations</h2>
          <span className="eia-muted">0 subjects</span>
        </div>
        <div className="eia-empty">
          <p style={{ marginTop: 0 }}>
            No associations are recorded for {document.documentNumber}.
          </p>
          <p style={{ marginBottom: 0 }}>
            Associating a document with a policy, claim, payment, or party requires the Document
            association API, which is not exposed in this build. No association action is available.
          </p>
        </div>
      </>
    );
  }

  function renderTab() {
    if (!selectedDocument) return null;
    switch (activeTab) {
      case 'lifecycle':
        return renderLifecycle(selectedDocument);
      case 'retention':
        return renderRetention(selectedDocument);
      case 'associations':
        return renderAssociations(selectedDocument);
      default:
        return renderOverview(selectedDocument);
    }
  }

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Operations · Document</div>
          <h1>Document</h1>
          <p className="subtitle">
            Evidence records for every business vertical: metadata, classification, retention, and the
            governed lifecycle. Document never changes the business facts a document evidences.
          </p>
        </div>
        <div className="eia-actions">
          <button
            type="button"
            className="eia-btn-ghost"
            onClick={refresh}
            disabled={loading}
          >
            Refresh
          </button>
          <button type="button" onClick={openRegister} aria-haspopup="dialog">
            Register document
          </button>
        </div>
      </header>

      {notice && <p role="status" style={{ margin: '0 0 12px' }}>{notice}</p>}
      {error && !registerOpen && <p role="alert" style={{ margin: '0 0 12px' }}>{error}</p>}

      <div className="eia-record-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div
            className="eia-queue-search"
            role="search"
            aria-label="Filter the document queue"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <div className="eia-search-box" style={{ height: 38, flex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                id="document-queue-filter"
                value={queueFilter}
                onChange={(event) => setQueueFilter(event.target.value)}
                placeholder="Filter documents by number, title, type, or status…"
                aria-label="Filter documents by number, title, type, or status"
                autoComplete="off"
                data-testid="document-filter"
              />
            </div>
            {queueFilter && (
              <button type="button" className="eia-btn-ghost" onClick={() => setQueueFilter('')}>
                Clear
              </button>
            )}
          </div>

          <aside className="eia-record-list" aria-label="Document queue">
            <div className="eia-record-list-head">
              <strong>Document queue</strong>
              <span className="eia-muted" data-testid="queue-filter-count">
                {loading
                  ? '…'
                  : queueFilter
                    ? `${filteredDocuments.length} of ${documents.length} documents`
                    : documents.length}
              </span>
            </div>
            {loading && <div className="empty">Loading documents…</div>}
            {!loading && documents.length === 0 && (
              <div className="empty">No documents registered yet.</div>
            )}
            {!loading && documents.length > 0 && filteredDocuments.length === 0 && (
              <div className="empty" data-testid="queue-filter-empty">
                No documents match “{queueFilter.trim()}”. Clear the filter to see the full queue.
              </div>
            )}
            {filteredDocuments.map((document) => (
              <button
                key={document.id}
                type="button"
                className={document.id === selectedId ? 'selected' : ''}
                aria-pressed={document.id === selectedId}
                aria-label={`Open record ${document.documentNumber}`}
                onClick={() => selectDocument(document)}
              >
                <span className="record-primary">{document.documentNumber}</span>
                <span
                  className="record-secondary"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={document.title}
                >
                  {document.title}
                </span>
                <span
                  className="record-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                >
                  <span>{document.documentType}</span>
                  <StatusPill status={document.status} />
                </span>
              </button>
            ))}
          </aside>
        </div>

        <section className="eia-record-panel" aria-label="Document record" aria-busy={detailLoading}>
          {!selectedDocument ? (
            <div className="eia-empty">
              <p style={{ marginTop: 0 }}>
                {loading
                  ? 'Loading the document queue…'
                  : 'Select a document from the queue, or register the first evidence record.'}
              </p>
              {!loading && (
                <button type="button" onClick={openRegister} aria-haspopup="dialog">
                  Register document
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="eia-record-title">
                <div>
                  <h2 className="eia-mono">{selectedDocument.documentNumber}</h2>
                  <p className="eia-record-subtitle">
                    <strong>{selectedDocument.title}</strong>
                    {' · '}
                    <span
                      className={`eia-pill ${statusTone(selectedDocument.status)}`}
                      data-testid="record-status"
                    >
                      {selectedDocument.status}
                    </span>
                    {' · '}
                    <span
                      className={`eia-badge ${classificationTone(selectedDocument.classification)}`.trim()}
                      data-testid="record-classification"
                    >
                      {selectedDocument.classification}
                    </span>
                  </p>
                </div>
                <div className="eia-actions">
                  <button
                    type="button"
                    className="eia-btn-ghost"
                    onClick={refresh}
                    disabled={loading || detailLoading}
                  >
                    Refresh record
                  </button>
                </div>
              </div>

              {detailLoading && (
                <p className="eia-muted" role="status" style={{ margin: '0 0 10px' }}>
                  Loading record…
                </p>
              )}

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Type</h3>
                  <div className="value" data-testid="summary-type">{selectedDocument.documentType}</div>
                  <div className="eia-metric-label">Document type</div>
                </div>
                <div className="eia-card">
                  <h3>Classification</h3>
                  <div className="value" data-testid="summary-classification">
                    {selectedDocument.classification}
                  </div>
                  <div className="eia-metric-label">Access classification</div>
                </div>
                <div className="eia-card">
                  <h3>Retention</h3>
                  <div className="value" data-testid="summary-retention">
                    {selectedDocument.retentionUntil || 'Not set'}
                  </div>
                  <div className="eia-metric-label">Retain until</div>
                </div>
                <div className="eia-card">
                  <h3>Version</h3>
                  <div className="value" data-testid="summary-version">
                    {selectedDocument.version ?? '—'}
                  </div>
                  <div className="eia-metric-label">Record version</div>
                </div>
              </div>

              <div className="eia-tabs" role="tablist" aria-label="Document sections">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    id={`document-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    aria-controls="document-tabpanel"
                    className={`eia-tab ${activeTab === tab.id ? 'active' : ''}`.trim()}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div
                id="document-tabpanel"
                role="tabpanel"
                aria-labelledby={`document-tab-${activeTab}`}
              >
                {renderTab()}
              </div>
            </>
          )}
        </section>
      </div>

      {registerOpen && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !registerBusy) closeRegister();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-document-title"
            className="eia-card"
            style={DIALOG_STYLE}
          >
            <div className="eia-record-title">
              <div>
                <h2 id="register-document-title" style={{ margin: 0 }}>Register document</h2>
                <p className="eia-record-subtitle">
                  Record document metadata. The server assigns the document number and starts the
                  RECEIVED lifecycle.
                </p>
              </div>
              <button
                type="button"
                className="eia-btn-ghost"
                onClick={closeRegister}
                disabled={registerBusy}
              >
                Close
              </button>
            </div>

            <form
              className="eia-form-grid"
              aria-label="Register document"
              onSubmit={submit}
              style={{ marginTop: 16 }}
            >
              <Field label="Title" htmlFor="title" className="span-2">
                <input
                  id="title"
                  value={form.title}
                  maxLength={300}
                  onChange={update('title')}
                  required
                  autoFocus
                />
              </Field>
              <Field label="Retention until" htmlFor="retentionUntil">
                <input
                  id="retentionUntil"
                  type="date"
                  value={form.retentionUntil}
                  onChange={update('retentionUntil')}
                />
              </Field>
              <Field label="Document type" htmlFor="documentType" className="span-2">
                <select id="documentType" value={form.documentType} onChange={update('documentType')}>
                  {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </Field>
              <Field label="Classification" htmlFor="classification">
                <select
                  id="classification"
                  value={form.classification}
                  onChange={update('classification')}
                >
                  {CLASSIFICATIONS.map((classification) => (
                    <option key={classification} value={classification}>{classification}</option>
                  ))}
                </select>
              </Field>

              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeRegister}
                  disabled={registerBusy}
                >
                  Cancel
                </button>
                <button type="submit" disabled={registerBusy}>
                  {registerBusy ? 'Registering…' : 'Register document'}
                </button>
              </div>
            </form>

            {error && <p role="alert" style={{ margin: '10px 0 0' }}>{error}</p>}
          </section>
        </div>
      )}
    </main>
  );
}

import React, { useEffect, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';

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

// SPEC 11.6.6 lifecycle edges; the domain service enforces the same map.
const NEXT_STATUSES = {
  PENDING_UPLOAD: ['RECEIVED'],
  RECEIVED: ['SCANNING'],
  SCANNING: ['PROCESSING', 'REJECTED'],
  PROCESSING: ['CLASSIFIED', 'FAILED'],
  CLASSIFIED: ['ACTIVE'],
  ACTIVE: ['SUPERSEDED', 'ON_HOLD', 'ARCHIVED', 'DISPOSED'],
  ON_HOLD: ['ACTIVE'],
  ARCHIVED: ['DISPOSED', 'ON_HOLD'],
  FAILED: ['PROCESSING']
};

const EMPTY_FORM = { title: '', documentType: 'POLICY', classification: 'INTERNAL', retentionUntil: '' };

async function readError(response) {
  try {
    const body = await response.json();
    if (body && body.code) {
      return `${body.code}: ${body.message}`;
    }
  } catch (ignored) {
    // The error envelope is JSON; fall back to the status when it is not.
  }
  return `Request failed with status ${response.status}`;
}

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [nextStatus, setNextStatus] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    const response = await fetch('/api/v1/documents', { headers: { 'X-EIA-Tenant': TENANT } });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    setDocuments(await response.json());
  }

  useEffect(() => {
    load().catch((failure) => setError(failure.message));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const response = await fetch('/api/v1/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EIA-Tenant': TENANT },
      body: JSON.stringify({ ...form, retentionUntil: form.retentionUntil || null })
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setForm(EMPTY_FORM);
    setNotice('Document registered.');
    await load();
  }

  async function advance(document) {
    const target = nextStatus[document.id] || (NEXT_STATUSES[document.status] || [])[0];
    if (!target) {
      return;
    }
    setError('');
    setNotice('');
    const response = await fetch(`/api/v1/documents/${document.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EIA-Tenant': TENANT },
      body: JSON.stringify({ status: target })
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setNotice(`${document.documentNumber} moved to ${target}.`);
    await load();
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1>Document</h1>
      <p>
        Document is evidence, not truth. Metadata, classification, retention, and the lifecycle
        are governed here; the business facts a document evidences stay with their owning vertical.
      </p>
      {error && <p role="alert" style={{ color: '#b00020' }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#0b6b3a' }}>{notice}</p>}

      <form onSubmit={submit} style={{ display: 'grid', gap: 8, marginBottom: 24, maxWidth: 480 }}>
        <label htmlFor="title">Title</label>
        <input
          id="title"
          value={form.title}
          maxLength={300}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          required
        />
        <label htmlFor="documentType">Document type</label>
        <select
          id="documentType"
          value={form.documentType}
          onChange={(event) => setForm({ ...form, documentType: event.target.value })}
        >
          {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <label htmlFor="classification">Classification</label>
        <select
          id="classification"
          value={form.classification}
          onChange={(event) => setForm({ ...form, classification: event.target.value })}
        >
          {CLASSIFICATIONS.map((classification) => (
            <option key={classification} value={classification}>{classification}</option>
          ))}
        </select>
        <label htmlFor="retentionUntil">Retention until</label>
        <input
          id="retentionUntil"
          type="date"
          value={form.retentionUntil}
          onChange={(event) => setForm({ ...form, retentionUntil: event.target.value })}
        />
        <button type="submit">Register document</button>
      </form>

      <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">Number</th>
            <th align="left">Title</th>
            <th align="left">Type</th>
            <th align="left">Classification</th>
            <th align="left">Status</th>
            <th align="left">Retained until</th>
            <th align="left">Lifecycle</th>
          </tr>
        </thead>
        <tbody>
          {documents.length === 0 && (
            <tr><td colSpan={7}>No documents registered yet.</td></tr>
          )}
          {documents.map((document) => {
            const targets = NEXT_STATUSES[document.status] || [];
            return (
              <tr key={document.id} style={{ borderTop: '1px solid #ddd' }}>
                <td>{document.documentNumber}</td>
                <td>{document.title}</td>
                <td>{document.documentType}</td>
                <td>{document.classification}</td>
                <td>{document.status}</td>
                <td>{document.retentionUntil || '—'}</td>
                <td>
                  {targets.length === 0 ? 'Final state' : (
                    <>
                      <select
                        aria-label={`Next status for ${document.documentNumber}`}
                        value={nextStatus[document.id] || targets[0]}
                        onChange={(event) => setNextStatus({ ...nextStatus, [document.id]: event.target.value })}
                      >
                        {targets.map((target) => <option key={target} value={target}>{target}</option>)}
                      </select>
                      <button type="button" onClick={() => advance(document)}>Apply</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}

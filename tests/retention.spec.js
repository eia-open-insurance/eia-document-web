import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const DOCUMENT_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';
const HOLD_PATH = `/api/v1/documents/${DOCUMENT_ID}/hold`;
const RELEASE_PATH = `${HOLD_PATH}/release`;
const DISPOSE_PATH = `/api/v1/documents/${DOCUMENT_ID}/dispose`;
const CONTENT_PATH = `/api/v1/documents/${DOCUMENT_ID}/content`;
const CONTENT_METADATA_PATH = `${CONTENT_PATH}/metadata`;

const FILE_METADATA = {
  documentId: DOCUMENT_ID,
  fileName: 'policy-schedule.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1843200,
  sha256: '9f2c0f4d3a8e7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c',
  uploadedAt: '2026-10-20T15:04:00Z',
  currentVersion: 3
};

function document(overrides = {}) {
  return {
    id: DOCUMENT_ID,
    tenantId: TENANT,
    documentNumber: 'DOC-2026-0000001',
    title: 'Policy schedule',
    documentType: 'POLICY',
    classification: 'CONFIDENTIAL',
    status: 'ACTIVE',
    // Far enough in the past that the retention date is reached in any test run.
    retentionUntil: '2020-01-01',
    version: 3,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    legalHold: false,
    ...overrides
  };
}

/**
 * Stateful mock for the retention surface of the public Document API:
 * list/get plus place-hold, release-hold, and dispose. Each command mutates the
 * stored record and answers with the updated document, which is the shape the
 * workbench folds back into the queue.
 *
 * `options.content` seeds the stored file. Disposition tombstones it, the way
 * the backend does; `options.keepContentOnDispose` leaves the metadata read
 * behind (still reporting the file) so the workbench's own tombstone handling
 * can be exercised.
 */
async function installRetentionMock(page, overrides = {}, options = {}) {
  const { content = null, keepContentOnDispose = false, metadataStatus = 0 } = options;
  const state = {
    doc: document(overrides),
    contents: new Map(content ? [[DOCUMENT_ID, { ...content }]] : []),
    requests: [],
    failures: { hold: false, release: false, dispose: false },
    metadataStatus
  };

  await page.route('**/api/v1/events/aggregate/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ aggregateId: DOCUMENT_ID, limit: 50, items: [] })
    })
  );

  await page.route('**/api/v1/documents**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? request.postDataJSON() : null;
    state.requests.push({ method, path, body, headers: request.headers() });

    const fulfill = (status, payload) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
    const notFound = () => fulfill(404, {
      code: 'DOCUMENT_NOT_FOUND',
      message: `Document not found: ${path}`
    });

    if (path === '/api/v1/documents' && method === 'GET') {
      return fulfill(200, [state.doc]);
    }

    const releaseMatch = path.match(/^\/api\/v1\/documents\/([^/]+)\/hold\/release$/);
    if (releaseMatch && method === 'POST') {
      if (state.failures.release) {
        return fulfill(409, {
          code: 'HOLD_NOT_ACTIVE',
          message: 'The document has no active legal hold to release.'
        });
      }
      const restored = state.doc.statusBeforeHold || 'ACTIVE';
      state.doc = {
        ...state.doc,
        status: restored,
        legalHold: false,
        holdReason: null,
        heldAt: null,
        statusBeforeHold: null,
        version: state.doc.version + 1,
        updatedAt: '2026-10-21T18:45:00Z'
      };
      return fulfill(200, state.doc);
    }

    const holdMatch = path.match(/^\/api\/v1\/documents\/([^/]+)\/hold$/);
    if (holdMatch && method === 'POST') {
      if (state.failures.hold) {
        return fulfill(409, {
          code: 'HOLD_REJECTED',
          message: 'The document is already under legal hold.'
        });
      }
      state.doc = {
        ...state.doc,
        status: 'ON_HOLD',
        legalHold: true,
        holdReason: body.reason,
        heldAt: '2026-10-21T18:30:00Z',
        statusBeforeHold: state.doc.status,
        version: state.doc.version + 1,
        updatedAt: '2026-10-21T18:30:00Z'
      };
      return fulfill(200, state.doc);
    }

    const disposeMatch = path.match(/^\/api\/v1\/documents\/([^/]+)\/dispose$/);
    if (disposeMatch && method === 'POST') {
      if (state.failures.dispose) {
        return fulfill(409, {
          code: 'DISPOSITION_REJECTED',
          message: 'The document cannot be disposed while a legal hold is active.'
        });
      }
      // Disposition destroys the stored content: the pointer keeps its audit
      // facts and gains the tombstone timestamp.
      if (state.contents.has(DOCUMENT_ID) && !keepContentOnDispose) {
        state.contents.set(DOCUMENT_ID, {
          ...state.contents.get(DOCUMENT_ID),
          deleted: true,
          deletedAt: '2026-10-21T19:00:00Z'
        });
      }
      state.doc = {
        ...state.doc,
        status: 'DISPOSED',
        disposedAt: '2026-10-21T19:00:00Z',
        legalHold: false,
        holdReason: null,
        heldAt: null,
        statusBeforeHold: null,
        version: state.doc.version + 1,
        updatedAt: '2026-10-21T19:00:00Z'
      };
      return fulfill(200, state.doc);
    }

    if (path === CONTENT_METADATA_PATH && method === 'GET') {
      if (state.metadataStatus) {
        return fulfill(state.metadataStatus, {
          code: 'CONTENT_METADATA_UNAVAILABLE',
          message: 'File metadata is temporarily unavailable.'
        });
      }
      const metadata = state.contents.get(DOCUMENT_ID);
      return metadata
        ? fulfill(200, metadata)
        : fulfill(404, {
            code: 'CONTENT_NOT_FOUND',
            message: 'No file is stored for this document.'
          });
    }

    if (path === `${CONTENT_PATH}/versions` && method === 'GET') {
      return fulfill(200, []);
    }

    if (path === CONTENT_PATH && method === 'GET') {
      const metadata = state.contents.get(DOCUMENT_ID);
      if (metadata?.deleted) {
        return fulfill(410, {
          code: 'CONTENT_DELETED',
          message: 'The stored content has been deleted.'
        });
      }
      return fulfill(404, {
        code: 'CONTENT_NOT_FOUND',
        message: 'No file is stored for this document.'
      });
    }

    if (path === CONTENT_PATH && method === 'DELETE') {
      return fulfill(409, {
        code: 'CONTENT_ALREADY_DELETED',
        message: 'No separate content delete is expected after disposition.'
      });
    }

    const detailMatch = path.match(/^\/api\/v1\/documents\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      return detailMatch[1] === state.doc.id ? fulfill(200, state.doc) : notFound();
    }

    return notFound();
  });

  return state;
}

test('places and releases a legal hold, updating the record and gating disposition', async ({ page }) => {
  const state = await installRetentionMock(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Retention' }).click();

  await expect(page.getByTestId('hold-status')).toHaveText('NOT HELD');
  await expect(page.getByTestId('hold-reason')).toHaveText('—');
  await expect(page.getByTestId('hold-held-date')).toHaveText('—');
  await expect(page.getByTestId('hold-status-before')).toHaveText('—');
  await expect(page.getByTestId('disposition-date')).toHaveText('—');
  await expect(page.getByTestId('disposition-status')).toHaveText('ELIGIBLE');
  await expect(page.getByTestId('dispose-document')).toBeEnabled();
  await expect(page.getByTestId('release-hold')).toBeDisabled();
  await expect(page.getByTestId('hold-eligibility')).toContainText('No legal hold is active');
  await expect(page.getByTestId('retention-context')).toContainText('Disposition is irreversible');
  await expect(page.getByTestId('retention-context')).toContainText('audit trail');

  await page.getByTestId('place-hold').click();
  const holdDialog = page.getByRole('dialog', { name: 'Place legal hold' });
  await expect(holdDialog).toBeVisible();

  // A reason is the audited basis of the hold; the form must reject a blank one
  // without issuing a request.
  await holdDialog.getByRole('button', { name: 'Place legal hold' }).click();
  await expect(holdDialog.getByTestId('hold-error')).toHaveText(
    'A reason is required to place a legal hold.'
  );
  expect(state.requests.some((request) => request.path === HOLD_PATH)).toBe(false);

  await holdDialog.getByLabel('Reason').fill('Litigation hold — matter 2026-0042');
  await holdDialog.getByRole('button', { name: 'Place legal hold' }).click();

  await expect(holdDialog).toBeHidden();
  await expect(page.getByText('Legal hold placed on DOC-2026-0000001.')).toBeVisible();
  await expect(page.getByTestId('record-status')).toHaveText('ON_HOLD');
  await expect(page.getByTestId('hold-status')).toHaveText('HELD');
  await expect(page.getByTestId('hold-reason')).toHaveText('Litigation hold — matter 2026-0042');
  await expect(page.getByTestId('hold-held-date')).not.toHaveText('—');
  await expect(page.getByTestId('hold-status-before')).toHaveText('ACTIVE');
  await expect(page.getByTestId('hold-eligibility')).toContainText('On legal hold');
  await expect(page.getByTestId('disposition-status')).toHaveText('BLOCKED');
  await expect(page.getByTestId('dispose-document')).toBeDisabled();
  await expect(page.getByTestId('place-hold')).toBeDisabled();
  await expect(page.getByTestId('release-hold')).toBeEnabled();
  await expect(page.getByTestId('disposition-eligibility')).toContainText(
    'Legal hold blocks disposition'
  );
  await expect(
    page.getByRole('button', { name: 'Open record DOC-2026-0000001' })
  ).toContainText('ON_HOLD');

  const holdRequest = state.requests.find((request) => request.path === HOLD_PATH);
  expect(holdRequest.method).toBe('POST');
  expect(holdRequest.body).toEqual({ reason: 'Litigation hold — matter 2026-0042' });

  await page.getByTestId('release-hold').click();

  await expect(page.getByText('Legal hold released on DOC-2026-0000001.')).toBeVisible();
  await expect(page.getByTestId('record-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('hold-status')).toHaveText('NOT HELD');
  await expect(page.getByTestId('hold-reason')).toHaveText('—');
  await expect(page.getByTestId('hold-held-date')).toHaveText('—');
  await expect(page.getByTestId('hold-status-before')).toHaveText('—');
  await expect(page.getByTestId('dispose-document')).toBeEnabled();
  await expect(page.getByTestId('place-hold')).toBeEnabled();
  await expect(page.getByTestId('release-hold')).toBeDisabled();
  expect(state.doc.status).toBe('ACTIVE');
  expect(state.doc.legalHold).toBe(false);
  expect(state.requests.some((request) => request.path === RELEASE_PATH)).toBe(true);
  expect(state.requests.every((request) => request.headers['x-eia-tenant'] === TENANT)).toBe(true);
});

test('disposes only after an explicit red confirmation and retains the audit context', async ({ page }) => {
  const state = await installRetentionMock(page);

  await page.goto('/');
  await page.getByRole('tab', { name: 'Retention' }).click();
  await expect(page.getByTestId('dispose-document')).toBeEnabled();
  await expect(page.getByTestId('dispose-document')).toHaveClass(/eia-btn-danger/);

  await page.getByTestId('dispose-document').click();
  const disposeDialog = page.getByRole('dialog', { name: 'Dispose document' });
  await expect(disposeDialog).toBeVisible();
  await expect(disposeDialog.getByTestId('dispose-warning')).toContainText('irreversible');
  await expect(disposeDialog.getByTestId('dispose-warning')).toContainText('audit trail');
  await expect(disposeDialog.getByTestId('dispose-warning')).toContainText(
    'disposition certificate'
  );
  await expect(disposeDialog.getByTestId('confirm-dispose')).toHaveClass(/eia-btn-danger/);
  expect(state.requests.some((request) => request.path === DISPOSE_PATH)).toBe(false);

  // Cancelling closes the confirmation and leaves the record untouched.
  await disposeDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(disposeDialog).toBeHidden();
  await expect(page.getByTestId('record-status')).toHaveText('ACTIVE');
  expect(state.requests.some((request) => request.path === DISPOSE_PATH)).toBe(false);

  await page.getByTestId('dispose-document').click();
  await page
    .getByRole('dialog', { name: 'Dispose document' })
    .getByTestId('confirm-dispose')
    .click();

  await expect(page.getByRole('dialog', { name: 'Dispose document' })).toBeHidden();
  await expect(page.getByTestId('record-status')).toHaveText('DISPOSED');
  await expect(page.getByTestId('disposition-status')).toHaveText('DISPOSED');
  await expect(page.getByTestId('disposition-date')).not.toHaveText('—');
  await expect(page.getByTestId('disposition-date')).toContainText('2026');
  await expect(page.getByTestId('dispose-document')).toBeDisabled();
  await expect(page.getByTestId('place-hold')).toBeDisabled();
  await expect(page.getByTestId('release-hold')).toBeDisabled();
  await expect(page.getByTestId('disposition-eligibility')).toContainText('already been disposed');
  await expect(page.getByTestId('disposition-eligibility')).toContainText('audit trail');
  await expect(page.getByTestId('hold-eligibility')).toContainText('disposed record cannot be placed');
  await expect(
    page.getByText(
      'Document DOC-2026-0000001 disposed. The stored content was destroyed; the content tombstone, audit trail, and disposition certificate are retained.'
    )
  ).toBeVisible();
  expect(state.doc.status).toBe('DISPOSED');
  expect(state.requests.some((request) => request.path === DISPOSE_PATH)).toBe(true);
});

test('explains why disposition is blocked by retention and by a legal hold', async ({ page }) => {
  await installRetentionMock(page, { retentionUntil: '2999-12-31' });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Retention' }).click();

  await expect(page.getByTestId('disposition-status')).toHaveText('BLOCKED');
  await expect(page.getByTestId('dispose-document')).toBeDisabled();
  await expect(page.getByTestId('dispose-document')).toHaveAttribute(
    'title',
    /retention date of 2999-12-31 is reached/
  );
  await expect(page.getByTestId('disposition-eligibility')).toContainText('2999-12-31');
  await expect(page.getByTestId('disposition-eligibility')).toContainText('retention date');
  await expect(page.getByTestId('place-hold')).toBeEnabled();

  // A held record exposes the hold facts and blocks disposition outright.
  await page.unroute('**/api/v1/documents**');
  await page.unroute('**/api/v1/events/aggregate/**');
  await installRetentionMock(page, {
    status: 'ON_HOLD',
    legalHold: true,
    holdReason: 'Regulatory inquiry',
    heldAt: '2026-10-20T09:00:00Z',
    statusBeforeHold: 'ARCHIVED'
  });
  await page.reload();
  await page.getByRole('tab', { name: 'Retention' }).click();

  await expect(page.getByTestId('hold-status')).toHaveText('HELD');
  await expect(page.getByTestId('hold-reason')).toHaveText('Regulatory inquiry');
  await expect(page.getByTestId('hold-held-date')).toContainText('2026');
  await expect(page.getByTestId('hold-status-before')).toHaveText('ARCHIVED');
  await expect(page.getByTestId('hold-eligibility')).toContainText('On legal hold');
  await expect(page.getByTestId('place-hold')).toBeDisabled();
  await expect(page.getByTestId('release-hold')).toBeEnabled();
  await expect(page.getByTestId('dispose-document')).toBeDisabled();
  await expect(page.getByTestId('disposition-eligibility')).toContainText(
    'Legal hold blocks disposition'
  );
});

test('surfaces a hold rejection without changing the record', async ({ page }) => {
  const state = await installRetentionMock(page);
  state.failures.hold = true;

  await page.goto('/');
  await page.getByRole('tab', { name: 'Retention' }).click();
  await page.getByTestId('place-hold').click();
  const holdDialog = page.getByRole('dialog', { name: 'Place legal hold' });
  await holdDialog.getByLabel('Reason').fill('Litigation hold — matter 2026-0042');
  await holdDialog.getByRole('button', { name: 'Place legal hold' }).click();

  await expect(holdDialog.getByTestId('hold-error')).toContainText('HOLD_REJECTED');
  await expect(holdDialog).toBeVisible();
  await expect(page.getByTestId('record-status')).toHaveText('ACTIVE');
  expect(state.doc.status).toBe('ACTIVE');
  expect(state.doc.legalHold).toBe(false);
});

test('surfaces a release rejection without clearing the hold', async ({ page }) => {
  const state = await installRetentionMock(page, {
    status: 'ON_HOLD',
    legalHold: true,
    holdReason: 'Regulatory inquiry',
    heldAt: '2026-10-20T09:00:00Z',
    statusBeforeHold: 'ACTIVE'
  });
  state.failures.release = true;

  await page.goto('/');
  await page.getByRole('tab', { name: 'Retention' }).click();
  await page.getByTestId('release-hold').click();

  await expect(page.getByRole('alert')).toContainText('HOLD_NOT_ACTIVE');
  await expect(page.getByTestId('hold-status')).toHaveText('HELD');
  await expect(page.getByTestId('hold-reason')).toHaveText('Regulatory inquiry');
  await expect(page.getByTestId('record-status')).toHaveText('ON_HOLD');
  expect(state.doc.status).toBe('ON_HOLD');
  expect(state.doc.legalHold).toBe(true);
});

test('surfaces a dispose rejection without disposing the record', async ({ page }) => {
  const state = await installRetentionMock(page);
  state.failures.dispose = true;

  await page.goto('/');
  await page.getByRole('tab', { name: 'Retention' }).click();
  await page.getByTestId('dispose-document').click();
  const disposeDialog = page.getByRole('dialog', { name: 'Dispose document' });
  await disposeDialog.getByTestId('confirm-dispose').click();

  await expect(disposeDialog.getByTestId('dispose-error')).toContainText('DISPOSITION_REJECTED');
  await expect(disposeDialog).toBeVisible();
  await expect(page.getByTestId('record-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('disposition-date')).toHaveText('—');
  expect(state.doc.status).toBe('ACTIVE');
});

test('dispose tombstones stored content and the File tab shows it without a separate delete', async ({ page }) => {
  const state = await installRetentionMock(page, {}, { content: FILE_METADATA });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Retention' }).click();
  await expect(page.getByTestId('disposition-content')).toContainText(
    'Destroyed automatically on disposition'
  );
  await page.getByTestId('dispose-document').click();
  await page
    .getByRole('dialog', { name: 'Dispose document' })
    .getByTestId('confirm-dispose')
    .click();

  await expect(page.getByRole('dialog', { name: 'Dispose document' })).toBeHidden();
  await expect(page.getByTestId('disposition-status')).toHaveText('DISPOSED');
  await expect(page.getByTestId('disposition-content')).toContainText(
    'Destroyed automatically; tombstone retained'
  );
  await expect(page.getByTestId('retention-context')).toContainText('content tombstone');
  await expect(page.getByTestId('retention-context')).toContainText(
    'No separate content deletion is required'
  );
  await expect(page.getByTestId('disposition-eligibility')).toContainText(
    'stored content was destroyed'
  );

  // The successful command refreshes both projections before the tab changes.
  const disposeIndex = state.requests.findIndex(
    (request) => request.method === 'POST' && request.path === DISPOSE_PATH
  );
  expect(disposeIndex).toBeGreaterThanOrEqual(0);
  expect(
    state.requests.filter(
      (request, index) =>
        index > disposeIndex &&
        request.method === 'GET' &&
        request.path === CONTENT_METADATA_PATH
    ).length
  ).toBeGreaterThan(0);
  expect(
    state.requests.filter(
      (request, index) =>
        index > disposeIndex &&
        request.method === 'GET' &&
        request.path === `/api/v1/documents/${DOCUMENT_ID}`
    ).length
  ).toBeGreaterThan(0);
  expect(state.contents.get(DOCUMENT_ID).deleted).toBe(true);

  await page.getByRole('tab', { name: 'Lifecycle' }).click();
  await expect(page.getByTestId('lifecycle-disposition-note')).toContainText(
    'stored content was destroyed automatically'
  );
  await expect(page.getByTestId('lifecycle-disposition-note')).toContainText(
    'no separate content deletion is required'
  );

  await page.getByRole('tab', { name: 'File' }).click();
  await expect(page.getByTestId('content-deleted')).toBeVisible();
  await expect(page.getByTestId('content-deleted-badge')).toHaveText('DELETED');
  await expect(page.getByTestId('content-deleted-warning')).toContainText(
    'Disposition destroyed the stored bytes automatically'
  );
  await expect(page.getByTestId('content-deleted-warning')).toContainText(
    'No separate content deletion is required'
  );
  await expect(page.getByTestId('content-file-name')).toHaveText('policy-schedule.pdf');
  await expect(page.getByTestId('content-current-version')).toHaveText('v3');
  await expect(page.getByTestId('content-file-type')).toHaveText('application/pdf');
  await expect(page.getByTestId('content-file-size')).toHaveText('1.8 MiB');
  await expect(page.getByTestId('content-file-sha256')).toHaveText(FILE_METADATA.sha256);
  await expect(page.getByTestId('content-deleted-at')).toContainText('Oct 21, 2026');
  await expect(page.getByTestId('download-content')).toBeDisabled();
  await expect(page.getByTestId('delete-content')).toBeDisabled();
  await expect(page.getByTestId('delete-content-eligibility')).toContainText(
    'No separate content deletion is required'
  );
  await expect(page.getByTestId('version-history')).toBeVisible();

  // Disposition tombstoned the content; no second DELETE command was needed.
  expect(state.requests.filter((request) => request.method === 'DELETE')).toHaveLength(0);
});

test('dispose leaves the File tab empty when no content was ever stored', async ({ page }) => {
  const state = await installRetentionMock(page);

  await page.goto('/');
  await page.getByRole('tab', { name: 'Retention' }).click();
  await page.getByTestId('dispose-document').click();
  await page
    .getByRole('dialog', { name: 'Dispose document' })
    .getByTestId('confirm-dispose')
    .click();

  await expect(page.getByRole('dialog', { name: 'Dispose document' })).toBeHidden();
  await page.getByRole('tab', { name: 'File' }).click();

  const empty = page.getByTestId('no-content');
  await expect(empty).toContainText('No file stored');
  await expect(empty).toContainText('has been disposed');
  await expect(empty).toContainText('no replacement file is offered');
  await expect(page.getByTestId('content-deleted')).toHaveCount(0);
  await expect(page.getByLabel('File to upload')).toHaveCount(0);
  await expect(page.getByTestId('delete-content')).toBeDisabled();
  await expect(page.getByTestId('delete-content-eligibility')).toContainText(
    'nothing to delete'
  );
  expect(state.contents.size).toBe(0);
  expect(state.requests.filter((request) => request.method === 'DELETE')).toHaveLength(0);
});

test('dispose still shows the tombstone when the content metadata read lags', async ({ page }) => {
  const state = await installRetentionMock(
    page,
    {},
    { content: FILE_METADATA, keepContentOnDispose: true }
  );

  await page.goto('/');
  await page.getByRole('tab', { name: 'Retention' }).click();
  await page.getByTestId('dispose-document').click();
  await page
    .getByRole('dialog', { name: 'Dispose document' })
    .getByTestId('confirm-dispose')
    .click();

  await expect(page.getByRole('dialog', { name: 'Dispose document' })).toBeHidden();
  // The mock still reports the pre-disposition file: the disposition fact wins.
  expect(state.contents.get(DOCUMENT_ID).deleted).toBeUndefined();

  await page.getByRole('tab', { name: 'File' }).click();
  await expect(page.getByTestId('content-deleted')).toBeVisible();
  await expect(page.getByTestId('content-file-name')).toHaveText('policy-schedule.pdf');
  await expect(page.getByTestId('content-file-sha256')).toHaveText(FILE_METADATA.sha256);
  await expect(page.getByTestId('download-content')).toBeDisabled();
  await expect(page.getByTestId('delete-content')).toBeDisabled();
  expect(state.requests.filter((request) => request.method === 'DELETE')).toHaveLength(0);
});

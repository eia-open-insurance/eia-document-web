import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const DOCUMENT_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';

const DOCUMENT = {
  id: DOCUMENT_ID,
  tenantId: TENANT,
  documentNumber: 'DOC-2026-0000001',
  title: 'Policy schedule',
  documentType: 'POLICY',
  classification: 'CONFIDENTIAL',
  status: 'ACTIVE',
  retentionUntil: '2036-10-19',
  version: 3,
  createdAt: '2026-10-19T12:00:00Z',
  updatedAt: '2026-10-19T12:00:00Z'
};

/**
 * Stateful mock for the public Document API. It implements the four routes the
 * remote uses: list, get by id, register, and change status.
 */
async function installDocumentMock(page, initial = [DOCUMENT]) {
  const state = {
    documents: initial.map((document) => ({ ...document })),
    requests: []
  };

  await page.route('**/api/v1/documents**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    state.requests.push({ method, path, headers: request.headers() });

    const fulfill = (status, body) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
    const notFound = () => fulfill(404, {
      code: 'DOCUMENT_NOT_FOUND',
      message: `Document not found: ${path}`
    });

    if (path === '/api/v1/documents' && method === 'GET') {
      return fulfill(200, state.documents);
    }

    if (path === '/api/v1/documents' && method === 'POST') {
      const body = request.postDataJSON();
      const created = {
        id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a99',
        tenantId: TENANT,
        documentNumber: `DOC-2026-${String(state.documents.length + 1).padStart(7, '0')}`,
        title: body.title,
        documentType: body.documentType,
        classification: body.classification,
        status: 'RECEIVED',
        retentionUntil: body.retentionUntil,
        version: 0,
        createdAt: '2026-10-20T09:00:00Z',
        updatedAt: '2026-10-20T09:00:00Z'
      };
      state.documents = [created, ...state.documents];
      return fulfill(201, created);
    }

    const statusMatch = path.match(/^\/api\/v1\/documents\/([^/]+)\/status$/);
    if (statusMatch && method === 'POST') {
      const document = state.documents.find((entry) => entry.id === statusMatch[1]);
      if (!document) return notFound();
      const body = request.postDataJSON();
      document.status = body.status;
      document.version += 1;
      document.updatedAt = '2026-10-20T10:00:00Z';
      return fulfill(200, document);
    }

    const detailMatch = path.match(/^\/api\/v1\/documents\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const document = state.documents.find((entry) => entry.id === detailMatch[1]);
      return document ? fulfill(200, document) : notFound();
    }

    return notFound();
  });

  return state;
}

test('renders the operational document record and hydrates the selected document', async ({ page }) => {
  const state = await installDocumentMock(page);

  await page.goto('/');

  await expect(page.getByText('Operations · Document')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Document', exact: true })).toBeVisible();
  await expect(page.locator('.eia-record-layout')).toHaveCSS('display', 'grid');

  const queueRecord = page.getByRole('button', { name: 'Open record DOC-2026-0000001' });
  await expect(queueRecord).toBeVisible();
  await expect(queueRecord).toContainText('Policy schedule');
  await expect(queueRecord).toContainText('POLICY');
  await expect(queueRecord).toContainText('ACTIVE');

  await expect(page.getByRole('heading', { name: 'DOC-2026-0000001' })).toBeVisible();
  await expect(page.getByTestId('record-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('record-classification')).toHaveText('CONFIDENTIAL');

  const summary = page.locator('.eia-summary-grid');
  await expect(summary).toContainText('Type');
  await expect(summary).toContainText('Classification');
  await expect(summary).toContainText('Retention');
  await expect(summary).toContainText('Version');
  await expect(page.getByTestId('summary-type')).toHaveText('POLICY');
  await expect(page.getByTestId('summary-classification')).toHaveText('CONFIDENTIAL');
  await expect(page.getByTestId('summary-retention')).toHaveText('2036-10-19');
  await expect(page.getByTestId('summary-version')).toHaveText('3');

  await expect
    .poll(() => state.requests.some(
      (request) => request.method === 'GET' && request.path === `/api/v1/documents/${DOCUMENT_ID}`
    ))
    .toBe(true);

  const listReads = state.requests.filter(
    (request) => request.method === 'GET' && request.path === '/api/v1/documents'
  ).length;
  const detailReads = state.requests.filter(
    (request) => request.method === 'GET' && request.path === `/api/v1/documents/${DOCUMENT_ID}`
  ).length;
  await page.getByRole('button', { name: 'Refresh record' }).click();
  await expect
    .poll(() => state.requests.filter(
      (request) => request.method === 'GET' && request.path === '/api/v1/documents'
    ).length)
    .toBeGreaterThan(listReads);
  await expect
    .poll(() => state.requests.filter(
      (request) => request.method === 'GET' && request.path === `/api/v1/documents/${DOCUMENT_ID}`
    ).length)
    .toBeGreaterThan(detailReads);
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000001' })).toBeVisible();

  expect(state.requests.every((request) => request.headers['x-eia-tenant'] === TENANT)).toBe(true);
});

test('registers a document from the page action modal and selects the new record', async ({ page }) => {
  const state = await installDocumentMock(page);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open record DOC-2026-0000001' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Register document' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Register document' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Register document' })).toBeVisible();

  await dialog.getByLabel('Title').fill('New demand letter');
  await dialog.getByLabel('Document type').selectOption('DEMAND_LETTER');
  await dialog.getByLabel('Classification').selectOption('RESTRICTED');
  await dialog.getByLabel('Retention until').fill('2040-01-31');
  await dialog.getByRole('button', { name: 'Register document' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Document registered.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000002' })).toBeVisible();

  const createdRecord = page.getByRole('button', { name: 'Open record DOC-2026-0000002' });
  await expect(createdRecord).toContainText('New demand letter');
  await expect(createdRecord).toContainText('DEMAND_LETTER');
  await expect(createdRecord).toContainText('RECEIVED');
  await expect(page.getByTestId('record-status')).toHaveText('RECEIVED');
  await expect(page.getByTestId('summary-type')).toHaveText('DEMAND_LETTER');
  await expect(page.getByTestId('summary-classification')).toHaveText('RESTRICTED');
  await expect(page.getByTestId('summary-retention')).toHaveText('2040-01-31');
  await expect(page.getByTestId('summary-version')).toHaveText('0');

  expect(state.documents).toHaveLength(2);
  expect(state.documents[0].title).toBe('New demand letter');
  expect(state.documents[0].status).toBe('RECEIVED');
  expect(state.documents[0].retentionUntil).toBe('2040-01-31');
});

test('advances the document lifecycle and reaches a terminal state', async ({ page }) => {
  const state = await installDocumentMock(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000001' })).toBeVisible();

  await page.getByRole('tab', { name: 'Lifecycle' }).click();
  await expect(page.getByRole('tab', { name: 'Lifecycle' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Lifecycle' })).toBeVisible();
  await expect(page.locator('[aria-label="Current lifecycle state"]')).toContainText('ACTIVE');

  const nextStatus = page.getByLabel('Next status');
  await nextStatus.selectOption('ON_HOLD');
  await page.getByRole('button', { name: 'Apply status' }).click();

  await expect(page.getByText('DOC-2026-0000001 moved to ON_HOLD.')).toBeVisible();
  await expect(page.getByTestId('record-status')).toHaveText('ON_HOLD');
  await expect(page.getByRole('button', { name: 'Open record DOC-2026-0000001' })).toContainText('ON_HOLD');

  await page.getByLabel('Next status').selectOption('ACTIVE');
  await page.getByRole('button', { name: 'Apply status' }).click();
  await expect(page.getByTestId('record-status')).toHaveText('ACTIVE');

  await page.getByLabel('Next status').selectOption('SUPERSEDED');
  await page.getByRole('button', { name: 'Apply status' }).click();
  await expect(page.getByTestId('record-status')).toHaveText('SUPERSEDED');
  await expect(page.getByText('SUPERSEDED is a terminal state. No further lifecycle transitions are defined.')).toBeVisible();
  await expect(page.getByLabel('Next status')).toHaveCount(0);

  expect(state.documents[0].status).toBe('SUPERSEDED');
  expect(state.documents[0].version).toBe(6);
});

test('navigates every document tab and shows the unimplemented association state', async ({ page }) => {
  const state = await installDocumentMock(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000001' })).toBeVisible();

  const sections = [
    ['Overview', 'Document details'],
    ['Lifecycle', 'Lifecycle'],
    ['Retention', 'Retention'],
    ['Associations', 'Associations']
  ];

  for (const [tabName, heading] of sections) {
    const tab = page.getByRole('tab', { name: tabName });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel', { name: tabName });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }

  await expect(page.locator('.eia-empty')).toContainText('No associations are recorded');
  await expect(page.locator('.eia-empty')).toContainText('not exposed in this build');
  expect(state.requests.every((request) => !request.path.includes('/associations'))).toBe(true);
});

test('shows an empty queue and opens the register modal from the record panel', async ({ page }) => {
  await installDocumentMock(page, []);

  await page.goto('/');

  await expect(page.getByText('No documents registered yet.')).toBeVisible();
  await expect(page.getByText('Select a document from the queue, or register the first evidence record.')).toBeVisible();

  await page.locator('.eia-record-panel').getByRole('button', { name: 'Register document' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('form', { name: 'Register document' })).toBeVisible();
});

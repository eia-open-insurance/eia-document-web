import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';

const DOCUMENT_A = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72',
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

const DOCUMENT_B = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a73',
  tenantId: TENANT,
  documentNumber: 'DOC-2026-0000002',
  title: 'Loss run',
  documentType: 'LOSS_ADVICE',
  classification: 'INTERNAL',
  status: 'RECEIVED',
  retentionUntil: '2031-01-31',
  version: 0,
  createdAt: '2026-10-19T13:00:00Z',
  updatedAt: '2026-10-19T13:00:00Z'
};

/**
 * Stateful mock of the Document API. The workbench itself reads only list,
 * detail, register, and status; any other route falls through to a 404 and is
 * still recorded so a test can prove no association/search call was made.
 */
async function installDocumentMock(page, initial = [DOCUMENT_A, DOCUMENT_B], detail = {}) {
  const state = {
    documents: initial.map((document) => ({ ...document })),
    requests: []
  };

  await page.route('**/api/v1/documents**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    state.requests.push({ method, path, search: url.search, headers: request.headers() });

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
      return fulfill(200, document);
    }

    const detailMatch = path.match(/^\/api\/v1\/documents\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const document = state.documents.find((entry) => entry.id === detailMatch[1])
        || detail[detailMatch[1]];
      return document ? fulfill(200, document) : notFound();
    }

    return notFound();
  });

  return state;
}

test('opens a document directly from the record URL and follows popstate', async ({ page }) => {
  const state = await installDocumentMock(page);

  await page.goto(`/?record=${DOCUMENT_B.id}`);

  const panel = page.locator('.eia-record-panel');
  await expect(panel.getByRole('heading', { name: DOCUMENT_B.documentNumber })).toBeVisible();
  await expect(page.getByTestId('summary-type')).toHaveText('LOSS_ADVICE');
  await expect(page).toHaveURL(new RegExp(`record=${DOCUMENT_B.id}$`));

  await page
    .locator('aside[aria-label="Document queue"] button')
    .filter({ hasText: DOCUMENT_A.documentNumber })
    .click();
  await expect(panel.getByRole('heading', { name: DOCUMENT_A.documentNumber })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`record=${DOCUMENT_A.id}$`));

  // Browser back fires popstate; the requested record is re-applied from the URL.
  await page.goBack();
  await expect(panel.getByRole('heading', { name: DOCUMENT_B.documentNumber })).toBeVisible();
  await expect(page.getByTestId('record-status')).toHaveText('RECEIVED');
  await expect(page).toHaveURL(new RegExp(`record=${DOCUMENT_B.id}$`));

  expect(state.requests.every((request) => request.headers['x-eia-tenant'] === TENANT)).toBe(true);
});

test('loads a deep-linked record that is not in the queue yet', async ({ page }) => {
  const state = await installDocumentMock(page, [DOCUMENT_A], { [DOCUMENT_B.id]: DOCUMENT_B });

  await page.goto(`/?record=${DOCUMENT_B.id}`);

  const panel = page.locator('.eia-record-panel');
  const queue = page.locator('aside[aria-label="Document queue"]');
  await expect(panel.getByRole('heading', { name: DOCUMENT_B.documentNumber })).toBeVisible();
  await expect(queue.getByRole('button', { name: /DOC-2026-0000002/ })).toBeVisible();
  expect(state.requests.some(
    (request) => request.method === 'GET' && request.path === `/api/v1/documents/${DOCUMENT_B.id}`
  )).toBe(true);
});

test('keeps the shell /document path when the URL record changes', async ({ page }) => {
  await installDocumentMock(page);

  await page.goto(`/document?record=${DOCUMENT_A.id}`);
  await expect(page.locator('.eia-record-panel').getByRole('heading', { name: DOCUMENT_A.documentNumber })).toBeVisible();

  await page
    .locator('aside[aria-label="Document queue"] button')
    .filter({ hasText: DOCUMENT_B.documentNumber })
    .click();

  await expect(page).toHaveURL(new RegExp(`/document\\?record=${DOCUMENT_B.id}$`));
  await expect(page.locator('.eia-record-panel').getByRole('heading', { name: DOCUMENT_B.documentNumber })).toBeVisible();
});

test('opens the register dialog from ?new=1 and keeps the URL in step', async ({ page }) => {
  await installDocumentMock(page);

  await page.goto('/?new=1');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Register document' })).toBeVisible();
  await expect(page).toHaveURL(/new=1/);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/new=1/);

  await page.getByRole('button', { name: 'Register document' }).click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/new=1/);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/new=1/);
});

test('filters the document queue by number, title, type, and status', async ({ page }) => {
  const state = await installDocumentMock(page);

  await page.goto('/');

  const queue = page.locator('aside[aria-label="Document queue"]');
  const filter = page.getByPlaceholder('Filter documents by number, title, type, or status…');
  const documentA = queue.getByRole('button', { name: /DOC-2026-0000001/ });
  const documentB = queue.getByRole('button', { name: /DOC-2026-0000002/ });

  await expect(filter).toBeVisible();
  await expect(documentA).toBeVisible();
  await expect(documentB).toBeVisible();

  for (const term of ['DOC-2026-0000002', 'Loss run', 'loss_advice', 'RECEIVED']) {
    await filter.fill(term);
    await expect(documentB).toBeVisible();
    await expect(documentA).toHaveCount(0);
  }

  await filter.fill('POLICY');
  await expect(documentA).toBeVisible();
  await expect(documentB).toHaveCount(0);
  await expect(page.getByTestId('queue-filter-count')).toHaveText('1 of 2 documents');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(documentA).toBeVisible();
  await expect(documentB).toBeVisible();
  await expect(page.getByTestId('queue-filter-count')).toHaveText('2');

  await filter.fill('no-such-document');
  await expect(documentA).toHaveCount(0);
  await expect(documentB).toHaveCount(0);
  await expect(page.getByTestId('queue-filter-empty')).toBeVisible();
  await expect(page.getByTestId('queue-filter-empty')).toContainText('No documents match “no-such-document”');

  // Filtering is local to the queue; the search endpoint is not involved.
  expect(state.requests.every((request) => !request.path.endsWith('/search'))).toBe(true);
});

test('explains the evidence context and the missing association API without inventing links', async ({ page }) => {
  const state = await installDocumentMock(page);

  await page.goto(`/?record=${DOCUMENT_A.id}`);

  const context = page.getByTestId('why-this-matters');
  await expect(context).toBeVisible();
  await expect(context).toContainText('Documents are evidence, not business facts');
  await expect(context).toContainText('They reference records in other verticals and never mutate them');

  const related = page.getByTestId('related-records');
  await expect(related.getByRole('heading', { name: 'Related records' })).toBeVisible();
  await expect(related).toContainText('Document associations are not yet exposed by this API');
  await expect(page.getByTestId('related-records-empty')).toBeVisible();
  await expect(page.getByTestId('related-records-empty')).toContainText('No related records are available yet');
  await expect(page.getByTestId('related-records-empty')).toContainText(
    'Document associations are not yet exposed by this API'
  );

  // No association endpoint exists, so the section must not fabricate links.
  await expect(related.getByRole('link')).toHaveCount(0);
  expect(state.requests.every((request) => !request.path.includes('/associations'))).toBe(true);
  expect(state.requests.every((request) => !request.path.endsWith('/search'))).toBe(true);
});

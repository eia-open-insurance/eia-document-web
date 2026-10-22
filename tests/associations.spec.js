import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const DOCUMENT_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';

const DIRECT_CLAIM_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const ASSUMED_CLAIM_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const POLICY_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const CONTRACT_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const PARTY_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const PAYMENT_ID = 'ffffffff-ffff-7fff-8fff-ffffffffffff';
const OTHER_ID = '99999999-9999-7999-8999-999999999999';
const MISSING_ID = '11111111-1111-7111-8111-111111111111';
const UNAVAILABLE_ID = '22222222-2222-7222-8222-222222222222';

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

const CLAIM_LINK = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4b01',
  linkedType: 'DIRECT_CLAIM',
  linkedId: DIRECT_CLAIM_ID,
  linkedReference: 'CLM-2026-0000001',
  addedAt: '2026-10-20T12:00:00Z'
};

const ALL_ROUTE_LINKS = [
  CLAIM_LINK,
  {
    id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4b02',
    linkedType: 'ASSUMED_CLAIM',
    linkedId: ASSUMED_CLAIM_ID,
    linkedReference: 'ACL-2026-0000001',
    addedAt: '2026-10-20T12:01:00Z'
  },
  {
    id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4b03',
    linkedType: 'POLICY',
    linkedId: POLICY_ID,
    linkedReference: 'POL-2026-0000001',
    addedAt: '2026-10-20T12:02:00Z'
  },
  {
    id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4b04',
    linkedType: 'CONTRACT',
    linkedId: CONTRACT_ID,
    linkedReference: 'CNT-2026-0000001',
    addedAt: '2026-10-20T12:03:00Z'
  },
  {
    id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4b05',
    linkedType: 'PARTY',
    linkedId: PARTY_ID,
    linkedReference: 'PTY-000000001',
    addedAt: '2026-10-20T12:04:00Z'
  },
  {
    id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4b06',
    linkedType: 'PAYMENT',
    linkedId: PAYMENT_ID,
    linkedReference: 'PAY-2026-0000001',
    addedAt: '2026-10-20T12:05:00Z'
  },
  {
    id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4b07',
    linkedType: 'OTHER',
    linkedId: OTHER_ID,
    linkedReference: 'LEGACY-REF-0001',
    addedAt: '2026-10-20T12:06:00Z'
  }
];

const SEARCH_ITEMS = {
  '/api/v1/claims/search': {
    type: 'DIRECT_CLAIM',
    id: DIRECT_CLAIM_ID,
    label: 'CLM-2026-0000001',
    secondary: 'OPEN · A. Adjuster',
    status: 'OPEN',
    href: `/direct-claims?record=${DIRECT_CLAIM_ID}`
  },
  '/api/v1/assumed-claims/search': {
    type: 'ASSUMED_CLAIM',
    id: ASSUMED_CLAIM_ID,
    label: 'ACL-2026-0000001',
    secondary: 'OPEN · B. Adjuster',
    status: 'OPEN',
    href: `/assumed-claims?record=${ASSUMED_CLAIM_ID}`
  },
  '/api/v1/policies/search': {
    type: 'POLICY',
    id: POLICY_ID,
    label: 'POL-2026-0000001',
    secondary: 'CGL · IN_FORCE',
    status: 'IN_FORCE',
    href: `/policy?record=${POLICY_ID}`
  },
  '/api/v1/contracts/search': {
    type: 'CONTRACT',
    id: CONTRACT_ID,
    label: 'CNT-2026-0000001',
    secondary: 'QUOTA_SHARE · ACTIVE',
    status: 'ACTIVE',
    href: `/contract?record=${CONTRACT_ID}`
  },
  '/api/v1/parties/search': {
    type: 'PARTY',
    id: PARTY_ID,
    label: 'PTY-000000001',
    secondary: 'Acme Manufacturing · ORGANIZATION',
    status: 'ACTIVE',
    href: `/party?record=${PARTY_ID}`
  },
  '/api/v1/payments/search': {
    type: 'PAYMENT',
    id: PAYMENT_ID,
    label: 'PAY-2026-0000001',
    secondary: 'USD 1,250.00 · SETTLED',
    status: 'SETTLED',
    href: `/payment?record=${PAYMENT_ID}`
  }
};

/** Detail projections used to hydrate labels for links stored without one. */
const DETAIL_ITEMS = {
  [`/api/v1/claims/${DIRECT_CLAIM_ID}`]: {
    id: DIRECT_CLAIM_ID,
    claimNumber: 'CLM-2026-0000001'
  },
  [`/api/v1/assumed-claims/claims/${ASSUMED_CLAIM_ID}`]: {
    id: ASSUMED_CLAIM_ID,
    assumedClaimNumber: 'ACL-2026-0000001'
  },
  [`/api/v1/policies/${POLICY_ID}`]: {
    id: POLICY_ID,
    policyNumber: 'POL-2026-0000001'
  },
  [`/api/v1/contracts/${CONTRACT_ID}`]: {
    id: CONTRACT_ID,
    contractNumber: 'CNT-2026-0000001'
  },
  [`/api/v1/parties/${PARTY_ID}`]: {
    id: PARTY_ID,
    partyNumber: 'PTY-000000001',
    displayName: 'Acme Manufacturing'
  },
  [`/api/v1/payments/${PAYMENT_ID}`]: {
    id: PAYMENT_ID,
    paymentNumber: 'PAY-2026-0000001'
  }
};

/** Stored links that predate the picker and therefore carry no reference. */
const UNLABELLED_LINKS = ALL_ROUTE_LINKS.filter((link) => link.linkedType !== 'OTHER').map(
  ({ linkedReference, ...link }) => link
);

const HYDRATION_CASES = [
  ['DIRECT_CLAIM', `/api/v1/claims/${DIRECT_CLAIM_ID}`, 'DIRECT', 'CLM-2026-0000001'],
  [
    'ASSUMED_CLAIM',
    `/api/v1/assumed-claims/claims/${ASSUMED_CLAIM_ID}`,
    'ASSUMED',
    'ACL-2026-0000001'
  ],
  ['POLICY', `/api/v1/policies/${POLICY_ID}`, 'DIRECT', 'POL-2026-0000001'],
  ['CONTRACT', `/api/v1/contracts/${CONTRACT_ID}`, 'ASSUMED', 'CNT-2026-0000001'],
  ['PARTY', `/api/v1/parties/${PARTY_ID}`, '', 'PTY-000000001'],
  ['PAYMENT', `/api/v1/payments/${PAYMENT_ID}`, '', 'PAY-2026-0000001']
];

/**
 * Stateful mock of the Document API plus the six cross-vertical search
 * endpoints the link picker can call. Links are returned on the document
 * record, matching the production projection.
 */
async function installDocumentMock(
  page,
  { links = [], duplicate = false, searchStatus = 0, detailFailures = {} } = {}
) {
  const state = {
    documents: [{ ...DOCUMENT }],
    links: links.map((link) => ({ ...link })),
    requests: [],
    searches: [],
    details: [],
    detailFailures: { ...detailFailures },
    duplicate,
    searchStatus
  };

  await page.route('**/api/v1/documents**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const body = method === 'POST' ? request.postDataJSON() : undefined;
    state.requests.push({ method, path, headers: request.headers(), body });

    const fulfill = (status, payload) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });

    if (path === '/api/v1/documents' && method === 'GET') {
      return fulfill(200, state.documents);
    }

    const linksMatch = path.match(/^\/api\/v1\/documents\/([^/]+)\/links$/);
    if (linksMatch && method === 'GET') {
      return fulfill(200, state.links);
    }
    if (linksMatch && method === 'POST') {
      if (state.duplicate) {
        return fulfill(409, {
          code: 'DUPLICATE_LINK',
          message: 'This record is already linked to the document.'
        });
      }
      const created = {
        id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4c01',
        linkedType: body.linkedType,
        linkedId: body.linkedId,
        linkedReference: body.linkedReference,
        addedAt: '2026-10-20T15:00:00Z'
      };
      state.links = [...state.links, created];
      return fulfill(201, created);
    }

    const removeLinkMatch = path.match(/^\/api\/v1\/documents\/([^/]+)\/links\/([^/]+)$/);
    if (removeLinkMatch && method === 'DELETE') {
      state.links = state.links.filter((link) => link.id !== removeLinkMatch[2]);
      return route.fulfill({ status: 204 });
    }

    const detailMatch = path.match(/^\/api\/v1\/documents\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const document = state.documents.find((entry) => entry.id === detailMatch[1]);
      return document
        ? fulfill(200, document)
        : fulfill(404, {
            code: 'DOCUMENT_NOT_FOUND',
            message: `Document not found: ${detailMatch[1]}`
          });
    }

    return fulfill(404, {
      code: 'DOCUMENT_NOT_FOUND',
      message: `Document not found: ${path}`
    });
  });

  await page.route(/\/api\/v1\/[^/]+\/search/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const item = SEARCH_ITEMS[path];
    state.searches.push({
      path,
      query: url.searchParams.get('q') || '',
      book: request.headers()['x-eia-book'] || '',
      headers: request.headers()
    });
    if (state.searchStatus) {
      return route.fulfill({
        status: state.searchStatus,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'SEARCH_UNAVAILABLE',
          message: 'Record search is temporarily unavailable.'
        })
      });
    }
    if (!item) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'NOT_FOUND', message: `No search at ${path}` })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: url.searchParams.get('q') || '',
        limit: 8,
        items: [item]
      })
    });
  });

  await page.route(
    /\/api\/v1\/(?:claims|policies|contracts|parties|payments|assumed-claims\/claims)\/[0-9a-f-]{36}$/i,
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      state.details.push({
        path,
        book: request.headers()['x-eia-book'] || '',
        headers: request.headers()
      });

      const failure = state.detailFailures[path];
      if (failure) {
        return route.fulfill({
          status: failure,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'DETAIL_UNAVAILABLE',
            message: `Detail read failed (${failure})`
          })
        });
      }

      const item = DETAIL_ITEMS[path];
      if (!item) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'NOT_FOUND', message: `No record at ${path}` })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(item)
      });
    }
  );

  return state;
}

async function openAssociations(page) {
  await expect(page.getByRole('heading', { name: DOCUMENT.documentNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Associations' }).click();
  await expect(page.getByRole('tab', { name: 'Associations' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
}

async function pickClaim(dialog) {
  await dialog.getByPlaceholder('Search by number or name…').fill('CLM-2026');
  const option = dialog.getByRole('button', { name: /CLM-2026-0000001/ });
  await expect(option).toBeVisible();
  await option.click();
}

test('renders linked records with type badges, added dates, and every shell route', async ({ page }) => {
  const state = await installDocumentMock(page, { links: ALL_ROUTE_LINKS });

  await page.goto('/');
  await openAssociations(page);

  await expect(page.getByTestId('link-count')).toHaveText('7 linked records');
  const table = page.getByRole('table', { name: 'Document links' });
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(7);

  const expectations = [
    ['DIRECT_CLAIM', 'CLM-2026-0000001', '/direct-claims'],
    ['ASSUMED_CLAIM', 'ACL-2026-0000001', '/assumed-claims'],
    ['POLICY', 'POL-2026-0000001', '/policy'],
    ['CONTRACT', 'CNT-2026-0000001', '/contract'],
    ['PARTY', 'PTY-000000001', '/party'],
    ['PAYMENT', 'PAY-2026-0000001', '/payment']
  ];

  for (const [type, reference, route] of expectations) {
    const row = table.locator('tbody tr').filter({ hasText: reference });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('link-type')).toHaveText(type);
    await expect(row.getByTestId('link-reference')).toHaveText(reference);
    await expect(row.getByTestId('link-record')).toHaveAttribute(
      'href',
      `${route}?record=${ALL_ROUTE_LINKS.find((link) => link.linkedType === type).linkedId}`
    );
    await expect(row.getByTestId('link-added')).toContainText('Oct 20, 2026');
  }

  const otherRow = table.locator('tbody tr').filter({ hasText: 'LEGACY-REF-0001' });
  await expect(otherRow.getByTestId('link-type')).toHaveText('OTHER');
  await expect(otherRow.getByRole('link')).toHaveCount(0);

  // The document read does not embed links; the association collection is read
  // explicitly and folded into the record.
  expect(
    state.requests.some(
      (request) =>
        request.method === 'GET' &&
        request.path === `/api/v1/documents/${DOCUMENT_ID}/links`
    )
  ).toBe(true);

  // The anchor still carries a shell href and navigates without a page load.
  await table
    .locator('tbody tr')
    .filter({ hasText: 'CLM-2026-0000001' })
    .getByTestId('link-record')
    .click();
  await expect(page).toHaveURL(new RegExp(`/direct-claims\\?record=${DIRECT_CLAIM_ID}$`));
});

test('hydrates stored link labels from the owning vertical detail read', async ({ page }) => {
  const state = await installDocumentMock(page, { links: UNLABELLED_LINKS });

  await page.goto('/');
  await openAssociations(page);

  const table = page.getByRole('table', { name: 'Document links' });
  await expect(table.locator('tbody tr')).toHaveCount(6);

  for (const [type, path, book, label] of HYDRATION_CASES) {
    const row = table.locator('tbody tr').filter({ hasText: type });
    await expect(row.getByTestId('link-reference')).toHaveText(label);
    await expect(row.getByTestId('link-record')).toHaveText(label);

    const detail = state.details.find((entry) => entry.path === path);
    expect(detail).toBeTruthy();
    expect(detail.headers['x-eia-tenant']).toBe(TENANT);
    expect(detail.book).toBe(book);
  }

  // One detail read per unlabelled link; the hydrated state does not refetch
  // on the re-render that the resolved labels cause.
  expect(state.details).toHaveLength(6);
});

test('keeps a stored reference without a detail read', async ({ page }) => {
  const state = await installDocumentMock(page, { links: [CLAIM_LINK] });

  await page.goto('/');
  await openAssociations(page);

  const row = page.getByTestId('document-link-row');
  await expect(row.getByTestId('link-reference')).toHaveText('CLM-2026-0000001');
  expect(state.details).toHaveLength(0);
});

test('falls back to the short id when a linked record cannot be read', async ({ page }) => {
  const missingLink = {
    id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4d01',
    linkedType: 'POLICY',
    linkedId: MISSING_ID,
    addedAt: '2026-10-20T12:07:00Z'
  };
  const unavailableLink = {
    id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4d02',
    linkedType: 'CONTRACT',
    linkedId: UNAVAILABLE_ID,
    addedAt: '2026-10-20T12:08:00Z'
  };
  const state = await installDocumentMock(page, {
    links: [CLAIM_LINK, missingLink, unavailableLink],
    detailFailures: {
      [`/api/v1/policies/${MISSING_ID}`]: 404,
      [`/api/v1/contracts/${UNAVAILABLE_ID}`]: 503
    }
  });

  await page.goto('/');
  await openAssociations(page);

  const table = page.getByRole('table', { name: 'Document links' });
  await expect(table.locator('tbody tr')).toHaveCount(3);

  const storedRow = table.locator('tbody tr').filter({ hasText: 'CLM-2026-0000001' });
  await expect(storedRow.getByTestId('link-reference')).toHaveText('CLM-2026-0000001');

  const missingRow = table.locator('tbody tr').filter({ hasText: 'POLICY' });
  await expect(missingRow.getByTestId('link-reference')).toHaveText('11111111…');
  await expect(missingRow.getByTestId('link-record')).toHaveText('11111111…');

  const unavailableRow = table.locator('tbody tr').filter({ hasText: 'CONTRACT' });
  await expect(unavailableRow.getByTestId('link-reference')).toHaveText('22222222…');

  // A failed detail read never blocks the document and is not retried on
  // every render; the stored reference needs no read at all.
  await expect(page.getByRole('heading', { name: DOCUMENT.documentNumber })).toBeVisible();
  expect(
    state.details.filter((entry) => entry.path.startsWith('/api/v1/claims/'))
  ).toHaveLength(0);
  expect(
    state.details.filter(
      (entry) =>
        entry.path === `/api/v1/policies/${MISSING_ID}` ||
        entry.path === `/api/v1/contracts/${UNAVAILABLE_ID}`
    )
  ).toHaveLength(2);
});

test('adds a direct-claim link from the predictive picker with the link payload', async ({ page }) => {
  const state = await installDocumentMock(page);

  await page.goto('/');
  await openAssociations(page);

  const empty = page.getByTestId('associations-empty');
  await expect(empty).toContainText('No business records are linked');
  await expect(empty).toContainText('This document is evidence');
  await expect(empty).toContainText('stored on the document record');

  await page.getByRole('button', { name: 'Add link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add link' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Linked type')).toHaveValue('DIRECT_CLAIM');

  await pickClaim(dialog);
  await expect(dialog.getByText('CLM-2026-0000001')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add link' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Link added to ${DOCUMENT.documentNumber}.`)).toBeVisible();
  const row = page.getByTestId('document-link-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('link-type')).toHaveText('DIRECT_CLAIM');
  await expect(row.getByTestId('link-reference')).toHaveText('CLM-2026-0000001');
  await expect(row.getByTestId('link-record')).toHaveAttribute(
    'href',
    `/direct-claims?record=${DIRECT_CLAIM_ID}`
  );

  const create = state.requests.find(
    (request) =>
      request.method === 'POST' && request.path === `/api/v1/documents/${DOCUMENT_ID}/links`
  );
  expect(create).toBeTruthy();
  expect(create.body).toEqual({
    linkedType: 'DIRECT_CLAIM',
    linkedId: DIRECT_CLAIM_ID,
    linkedReference: 'CLM-2026-0000001'
  });
  expect(create.headers['x-eia-tenant']).toBe(TENANT);

  const search = state.searches.find((entry) => entry.path === '/api/v1/claims/search');
  expect(search).toBeTruthy();
  expect(search.book).toBe('DIRECT');
  expect(search.query).toBe('CLM-2026');
});

test('changes the picker endpoint and book for every linked type', async ({ page }) => {
  const state = await installDocumentMock(page);

  await page.goto('/');
  await openAssociations(page);
  await page.getByRole('button', { name: 'Add link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add link' });

  const cases = [
    ['DIRECT_CLAIM', '/api/v1/claims/search', 'DIRECT', 'CLM-2026-0000001'],
    ['ASSUMED_CLAIM', '/api/v1/assumed-claims/search', 'ASSUMED', 'ACL-2026-0000001'],
    ['POLICY', '/api/v1/policies/search', 'DIRECT', 'POL-2026-0000001'],
    ['CONTRACT', '/api/v1/contracts/search', 'ASSUMED', 'CNT-2026-0000001'],
    ['PARTY', '/api/v1/parties/search', '', 'PTY-000000001'],
    ['PAYMENT', '/api/v1/payments/search', '', 'PAY-2026-0000001']
  ];

  for (const [type, path, book, label] of cases) {
    await dialog.getByLabel('Linked type').selectOption(type);
    const picker = dialog.getByPlaceholder('Search by number or name…');
    await expect(picker).toBeVisible();
    await picker.fill('2026');

    const option = dialog.getByRole('button', { name: new RegExp(label) });
    await expect(option).toBeVisible();
    const matches = state.searches.filter((entry) => entry.path === path);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[matches.length - 1].book).toBe(book);

    await option.click();
    await expect(dialog.getByText(label)).toBeVisible();
    await dialog.getByRole('button', { name: 'Change' }).click();
  }

  // OTHER is a manual reference, not a picker.
  await dialog.getByLabel('Linked type').selectOption('OTHER');
  await expect(dialog.getByLabel('Reference')).toBeVisible();
  await expect(dialog.getByLabel('UUID')).toBeVisible();
  await expect(dialog.getByPlaceholder('Search by number or name…')).toHaveCount(0);
});

test('debounces rapid picker typing into a single search request', async ({ page }) => {
  const state = await installDocumentMock(page);

  await page.goto('/');
  await openAssociations(page);
  await page.getByRole('button', { name: 'Add link' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add link' });
  const picker = dialog.getByPlaceholder('Search by number or name…');
  await picker.pressSequentially('CLM-2026', { delay: 20 });
  await expect(dialog.getByRole('button', { name: /CLM-2026-0000001/ })).toBeVisible();
  await page.waitForTimeout(250);

  const searches = state.searches.filter((entry) => entry.path === '/api/v1/claims/search');
  expect(searches).toHaveLength(1);
  expect(searches[0].query).toBe('CLM-2026');
  expect(searches[0].book).toBe('DIRECT');
  expect(searches[0].headers['x-eia-tenant']).toBe(TENANT);
});

test('contains a failed predictive lookup without submitting a link', async ({ page }) => {
  const state = await installDocumentMock(page, { searchStatus: 503 });

  await page.goto('/');
  await openAssociations(page);
  await page.getByRole('button', { name: 'Add link' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add link' });
  await dialog.getByPlaceholder('Search by number or name…').fill('CLM-2026');
  await expect(dialog.getByText('Lookup failed (503)')).toBeVisible();

  await dialog.getByRole('button', { name: 'Add link' }).click();
  await expect(dialog.getByTestId('link-error')).toContainText('Select a linked record');
  expect(state.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
});

test('removes a link with DELETE and clears the row', async ({ page }) => {
  const state = await installDocumentMock(page, { links: [CLAIM_LINK] });

  await page.goto('/');
  await openAssociations(page);

  const row = page.getByTestId('document-link-row');
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Remove', exact: true }).click();

  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('associations-empty')).toBeVisible();
  await expect(page.getByTestId('link-count')).toHaveText('0 linked records');
  await expect(page.getByText('Link to CLM-2026-0000001 removed.')).toBeVisible();

  const remove = state.requests.find((request) => request.method === 'DELETE');
  expect(remove).toBeTruthy();
  expect(remove.path).toBe(
    `/api/v1/documents/${DOCUMENT_ID}/links/${CLAIM_LINK.id}`
  );
  expect(remove.headers['x-eia-tenant']).toBe(TENANT);
});

test('surfaces a duplicate 409 without closing the dialog or adding a row', async ({ page }) => {
  const state = await installDocumentMock(page, { duplicate: true });

  await page.goto('/');
  await openAssociations(page);
  await page.getByRole('button', { name: 'Add link' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add link' });
  await pickClaim(dialog);
  await dialog.getByRole('button', { name: 'Add link' }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('link-error')).toContainText('DUPLICATE_LINK');
  await expect(dialog.getByTestId('link-error')).toContainText('already linked');
  await expect(page.getByTestId('document-link-row')).toHaveCount(0);

  const posts = state.requests.filter((request) => request.method === 'POST');
  expect(posts).toHaveLength(1);
});

test('validates the OTHER UUID and posts the manual reference', async ({ page }) => {
  const state = await installDocumentMock(page);

  await page.goto('/');
  await openAssociations(page);
  await page.getByRole('button', { name: 'Add link' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add link' });
  await dialog.getByLabel('Linked type').selectOption('OTHER');

  await dialog.getByRole('button', { name: 'Add link' }).click();
  await expect(dialog.getByTestId('link-error')).toContainText('Enter the UUID');
  expect(state.requests.filter((request) => request.method === 'POST')).toHaveLength(0);

  await dialog.getByLabel('Reference').fill('LEGACY-REF-9');
  await dialog.getByLabel('UUID').fill('not-a-uuid');
  await dialog.getByRole('button', { name: 'Add link' }).click();
  await expect(dialog.getByTestId('link-error')).toContainText('valid UUID');
  expect(state.requests.filter((request) => request.method === 'POST')).toHaveLength(0);

  await dialog.getByLabel('UUID').fill(OTHER_ID);
  await dialog.getByRole('button', { name: 'Add link' }).click();

  await expect(dialog).toBeHidden();
  const row = page.getByTestId('document-link-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('link-type')).toHaveText('OTHER');
  await expect(row.getByTestId('link-reference')).toHaveText('LEGACY-REF-9');
  await expect(row.getByRole('link')).toHaveCount(0);

  const create = state.requests.find((request) => request.method === 'POST');
  expect(create.body).toEqual({
    linkedType: 'OTHER',
    linkedId: OTHER_ID,
    linkedReference: 'LEGACY-REF-9'
  });
});

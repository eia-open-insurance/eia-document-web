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
  ...DOCUMENT_A,
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a73',
  documentNumber: 'DOC-2026-0000002',
  title: 'Signed endorsement',
  documentType: 'ENDORSEMENT',
  status: 'RECEIVED',
  version: 0
};

function notification(overrides = {}) {
  return {
    id: '99999999-9999-7999-8999-999999999991',
    tenantId: TENANT,
    notificationNumber: 'NTF-2026-000001',
    notificationType: 'DOCUMENT_REGISTERED',
    channel: 'EMAIL',
    status: 'SENT',
    subject: 'Document registered',
    sourceType: 'DOCUMENT',
    sourceId: DOCUMENT_A.id,
    sourceReference: DOCUMENT_A.documentNumber,
    createdAt: '2026-10-18T12:00:00Z',
    updatedAt: '2026-10-18T12:00:00Z',
    ...overrides
  };
}

// Deliberately newest-last and mixed with rows that point at another document
// or another source: the card must show only this document's newest three.
const NOTIFICATION_NEWEST = notification({
  id: '99999999-9999-7999-8999-999999999911',
  notificationNumber: 'NTF-2026-000011',
  notificationType: 'DOCUMENT_ARCHIVED',
  status: 'DELIVERED',
  subject: 'Document archived',
  createdAt: '2026-10-20T09:30:00Z'
});

const NOTIFICATION_MIDDLE = notification({
  id: '99999999-9999-7999-8999-999999999922',
  notificationNumber: 'NTF-2026-000022',
  notificationType: 'DOCUMENT_RETENTION_SET',
  status: 'READ',
  subject: 'Retention date updated',
  createdAt: '2026-10-19T16:15:00Z'
});

const NOTIFICATION_OLD = notification({
  id: '99999999-9999-7999-8999-999999999933',
  notificationNumber: 'NTF-2026-000033',
  notificationType: 'DOCUMENT_STATUS_CHANGED',
  status: 'QUEUED',
  subject: 'Document status changed',
  createdAt: '2026-10-18T08:05:00Z'
});

const NOTIFICATION_OLDEST = notification({
  id: '99999999-9999-7999-8999-999999999944',
  notificationNumber: 'NTF-2026-000044',
  notificationType: 'DOCUMENT_HELD',
  status: 'FAILED',
  subject: 'Legal hold delivery failed',
  createdAt: '2026-10-01T07:00:00Z'
});

const NOTIFICATION_OTHER_DOCUMENT = notification({
  id: '99999999-9999-7999-8999-999999999955',
  notificationNumber: 'NTF-2026-000055',
  sourceId: DOCUMENT_B.id,
  sourceReference: DOCUMENT_B.documentNumber,
  subject: 'Other document notice',
  createdAt: '2026-10-21T08:00:00Z'
});

const NOTIFICATION_OTHER_SOURCE = notification({
  id: '99999999-9999-7999-8999-999999999966',
  notificationNumber: 'NTF-2026-000066',
  sourceType: 'POLICY',
  subject: 'Policy notice',
  createdAt: '2026-10-22T08:00:00Z'
});

const RELATED = [
  NOTIFICATION_OLD,
  NOTIFICATION_NEWEST,
  NOTIFICATION_MIDDLE,
  NOTIFICATION_OLDEST,
  NOTIFICATION_OTHER_DOCUMENT,
  NOTIFICATION_OTHER_SOURCE
];

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks every route the document workbench calls on selection: the queue, the
 * record detail, its association collection, the activity aggregate, and the
 * related-notification lookup. `gate` keeps the notification response pending
 * so a test can observe the record while Notifications is still in flight.
 */
async function mockDocumentApi(page, {
  documents = [DOCUMENT_A],
  notificationsResponse = RELATED,
  notificationsStatus = 200,
  notificationsTotal = undefined,
  gate = null,
  onNotifications = null
} = {}) {
  const byId = new Map(documents.map((row) => [row.id, row]));

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/documents') {
      await json(route, 200, documents);
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/documents\/[^/]+\/links$/.test(path)) {
      await json(route, 200, []);
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/events\/aggregate\/[^/]+$/.test(path)) {
      await json(route, 200, { aggregateId: path.split('/').pop(), limit: 50, items: [] });
      return;
    }
    if (method === 'GET' && path === '/api/v1/notifications') {
      if (onNotifications) onNotifications(request, url);
      if (gate) await gate;
      const body = notificationsTotal === undefined
        ? notificationsResponse
        : { items: notificationsResponse, total: notificationsTotal };
      await json(route, notificationsStatus, body);
      return;
    }
    const detailMatch = path.match(/^\/api\/v1\/documents\/([^/]+)$/);
    if (method === 'GET' && detailMatch && byId.has(detailMatch[1])) {
      await json(route, 200, byId.get(detailMatch[1]));
      return;
    }
    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

test('shows the count and newest three related notifications with the source query', async ({ page }) => {
  const requests = [];

  await mockDocumentApi(page, {
    documents: [DOCUMENT_A, DOCUMENT_B],
    onNotifications: (request, url) => {
      requests.push({
        method: request.method(),
        path: url.pathname,
        sourceType: url.searchParams.get('sourceType'),
        sourceId: url.searchParams.get('sourceId'),
        tenant: request.headers()['x-eia-tenant'],
        book: request.headers()['x-eia-book'] || null
      });
    }
  });

  await page.goto(`/?record=${DOCUMENT_A.id}`);
  await expect(
    page.getByRole('heading', { name: DOCUMENT_A.documentNumber, level: 2 })
  ).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Related notifications' })).toBeVisible();
  await expect(card.getByTestId('related-notifications-count')).toHaveText('4 notifications');
  await expect(card.getByTestId('related-notifications-more'))
    .toHaveText('Showing the newest 3 of 4.');

  const rows = card.getByTestId('related-notification-row');
  await expect(rows).toHaveCount(3);

  // Newest first; the oldest related row and the unrelated rows stay hidden.
  await expect(rows.nth(0)).toContainText(NOTIFICATION_NEWEST.notificationNumber);
  await expect(rows.nth(0)).toContainText(NOTIFICATION_NEWEST.subject);
  await expect(rows.nth(0)).toContainText('DELIVERED');
  await expect(rows.nth(0).getByTestId('related-notification-status')).toHaveClass(/green/);
  await expect(rows.nth(0)).toContainText(/Oct 20, 2026/);
  await expect(rows.nth(1)).toContainText(NOTIFICATION_MIDDLE.notificationNumber);
  await expect(rows.nth(1)).toContainText('READ');
  await expect(rows.nth(2)).toContainText(NOTIFICATION_OLD.notificationNumber);
  await expect(rows.nth(2)).toContainText('QUEUED');
  await expect(rows.nth(2).getByTestId('related-notification-status')).toHaveClass(/amber/);
  await expect(card.getByText(NOTIFICATION_OLDEST.notificationNumber)).toHaveCount(0);
  await expect(card.getByText(NOTIFICATION_OTHER_DOCUMENT.notificationNumber)).toHaveCount(0);
  await expect(card.getByText(NOTIFICATION_OTHER_SOURCE.notificationNumber)).toHaveCount(0);

  // Each notification number opens that notification record.
  await expect(card.getByTestId(`related-notification-link-${NOTIFICATION_NEWEST.id}`))
    .toHaveAttribute('href', `/notifications?record=${NOTIFICATION_NEWEST.id}`);

  // View all keeps the document's source filter.
  await expect(card.getByTestId('related-notifications-view-all')).toHaveAttribute(
    'href',
    `/notifications?sourceType=DOCUMENT&sourceId=${DOCUMENT_A.id}`
  );
  await expect(card).toContainText('opens the Notifications queue filtered to this document');

  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    method: 'GET',
    path: '/api/v1/notifications',
    sourceType: 'DOCUMENT',
    sourceId: DOCUMENT_A.id,
    tenant: TENANT,
    book: null
  });

  // Selecting another document refetches notifications for its source id.
  await page
    .locator('.eia-record-list button')
    .filter({ hasText: DOCUMENT_B.documentNumber })
    .click();
  await expect(
    page.getByRole('heading', { name: DOCUMENT_B.documentNumber, level: 2 })
  ).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].sourceType).toBe('DOCUMENT');
  expect(requests[1].sourceId).toBe(DOCUMENT_B.id);
  expect(requests[1].tenant).toBe(TENANT);
  await expect(card.getByTestId('related-notifications-count')).toHaveText('1 notification');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(1);
  await expect(card).toContainText(NOTIFICATION_OTHER_DOCUMENT.subject);
});

test('accepts an {items} envelope and renders a single notification', async ({ page }) => {
  await mockDocumentApi(page, {
    notificationsResponse: [notification({ status: 'SENT' })],
    notificationsTotal: 1
  });

  await page.goto(`/?record=${DOCUMENT_A.id}`);

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('1 notification');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(1);
  await expect(card.getByTestId('related-notification-row')).toContainText('NTF-2026-000001');
  await expect(card.getByTestId('related-notification-row')).toContainText(/Oct 18, 2026/);
  await expect(card.getByTestId('related-notifications-more')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('shows the empty state without disturbing the document record', async ({ page }) => {
  await mockDocumentApi(page, { notificationsResponse: { items: [], total: 0 } });

  await page.goto(`/?record=${DOCUMENT_A.id}`);
  await expect(
    page.getByRole('heading', { name: DOCUMENT_A.documentNumber, level: 2 })
  ).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('0 notifications');
  await expect(card.getByTestId('related-notifications-empty'))
    .toHaveText('No notifications reference this document yet.');
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(card.getByTestId('related-notifications-more')).toHaveCount(0);

  // The card is still a working hand-off, and the record is untouched.
  await expect(card.getByTestId('related-notifications-view-all')).toHaveAttribute(
    'href',
    `/notifications?sourceType=DOCUMENT&sourceId=${DOCUMENT_A.id}`
  );
  await expect(page.getByTestId('record-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('summary-type')).toHaveText('POLICY');
  await expect(page.getByTestId('related-records')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contains a Notifications failure inside the card', async ({ page }) => {
  await mockDocumentApi(page, {
    notificationsStatus: 503,
    notificationsResponse: {
      code: 'NOTIFICATIONS_UNAVAILABLE',
      message: 'Notification service is unavailable'
    }
  });

  await page.goto(`/?record=${DOCUMENT_A.id}`);
  await expect(
    page.getByRole('heading', { name: DOCUMENT_A.documentNumber, level: 2 })
  ).toBeVisible();

  const card = page.getByTestId('related-notifications');
  const error = card.getByTestId('related-notifications-error');
  await expect(error).toContainText('Related notifications are temporarily unavailable');
  await expect(error).toContainText(
    'NOTIFICATIONS_UNAVAILABLE: Notification service is unavailable'
  );
  await expect(error).toContainText('The document record is unaffected.');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('—');
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(card.getByTestId('related-notifications-view-all')).toBeVisible();

  // The failure never becomes a page-level alert or replaces the record.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('record-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('summary-type')).toHaveText('POLICY');
  await expect(page.getByTestId('related-records')).toBeVisible();
});

test('renders the document while the Notifications API is still in flight', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  await mockDocumentApi(page, { notificationsResponse: RELATED, gate });

  await page.goto(`/?record=${DOCUMENT_A.id}`);

  // The record and its existing Overview cards are usable before notifications resolve.
  await expect(
    page.getByRole('heading', { name: DOCUMENT_A.documentNumber, level: 2 })
  ).toBeVisible();
  await expect(page.getByTestId('record-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('related-records')).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-loading')).toHaveText(
    'Loading related notifications…'
  );
  await expect(card.getByTestId('related-notifications-count')).toHaveText('…');

  release();

  await expect(card.getByTestId('related-notifications-count')).toHaveText('4 notifications');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(3);
});

test('refetches related notifications when the record is refreshed', async ({ page }) => {
  const requests = [];

  await mockDocumentApi(page, {
    onNotifications: () => requests.push(Date.now())
  });

  await page.goto(`/?record=${DOCUMENT_A.id}`);
  await expect(page.getByTestId('related-notification-row')).toHaveCount(3);
  await expect.poll(() => requests.length).toBe(1);

  await page.getByRole('button', { name: 'Refresh record' }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByTestId('related-notification-row')).toHaveCount(3);
});

test('opens a notification record and the filtered Notifications queue', async ({ page }) => {
  await mockDocumentApi(page);

  await page.goto(`/?record=${DOCUMENT_A.id}`);
  const card = page.getByTestId('related-notifications');
  await expect(card).toBeVisible();

  await card.getByTestId(`related-notification-link-${NOTIFICATION_NEWEST.id}`).click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?record=${NOTIFICATION_NEWEST.id}$`)
  );

  await page.goto(`/?record=${DOCUMENT_A.id}`);
  await expect(page.getByTestId('related-notifications')).toBeVisible();
  await page.getByTestId('related-notifications-view-all').click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?sourceType=DOCUMENT&sourceId=${DOCUMENT_A.id}$`)
  );
});

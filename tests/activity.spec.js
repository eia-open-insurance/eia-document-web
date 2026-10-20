import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const DOCUMENT_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';
const SECOND_DOCUMENT_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a73';
const EVENTS = '**/api/v1/events/aggregate/**';

const CREATED_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee1';
const STATUS_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee2';
const LINK_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee3';

function document(overrides = {}) {
  return {
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
    updatedAt: '2026-10-19T12:00:00Z',
    ...overrides
  };
}

/**
 * The aggregate endpoint embeds the canonical event envelope in `payload`; the
 * document facts are in `payload.data`. One helper builds that real shape.
 */
function aggregateEvent({
  eventId,
  eventType,
  occurredAt,
  aggregateVersion,
  aggregateId = DOCUMENT_ID,
  status = 'PROCESSED',
  data = {},
  payload
}) {
  return {
    eventId,
    eventType,
    eventVersion: 1,
    tenantId: TENANT,
    book: 'DIRECT',
    aggregateType: 'Document',
    aggregateId,
    aggregateVersion,
    occurredAt,
    receivedAt: occurredAt,
    status,
    payload: payload ?? {
      eventId,
      eventType,
      eventVersion: 1,
      tenantId: TENANT,
      book: 'DIRECT',
      aggregateType: 'Document',
      aggregateId,
      aggregateVersion,
      occurredAt,
      data
    }
  };
}

function createdEvent() {
  return aggregateEvent({
    eventId: CREATED_EVENT_ID,
    eventType: 'document.document.created',
    occurredAt: '2026-10-18T12:00:00Z',
    aggregateVersion: 1,
    data: {
      documentId: DOCUMENT_ID,
      documentNumber: 'DOC-2026-0000001',
      documentType: 'POLICY',
      classification: 'CONFIDENTIAL',
      retentionUntil: '2036-10-19',
      status: 'RECEIVED',
      version: 0
    }
  });
}

function statusChangedEvent() {
  return aggregateEvent({
    eventId: STATUS_EVENT_ID,
    eventType: 'document.document.status-changed',
    occurredAt: '2026-10-19T09:30:00Z',
    aggregateVersion: 2,
    // Some projections return the data object directly; the card accepts both.
    payload: {
      documentId: DOCUMENT_ID,
      documentNumber: 'DOC-2026-0000001',
      from: 'RECEIVED',
      to: 'ACTIVE',
      status: 'ACTIVE',
      version: 1
    }
  });
}

function linkAddedEvent() {
  return aggregateEvent({
    eventId: LINK_EVENT_ID,
    eventType: 'document.link.added',
    occurredAt: '2026-10-20T10:00:00Z',
    aggregateVersion: 3,
    data: {
      documentId: DOCUMENT_ID,
      documentNumber: 'DOC-2026-0000001',
      linkId: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4b01',
      linkedType: 'DIRECT_CLAIM',
      linkedId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      linkedReference: 'CLM-2026-0000001'
    }
  });
}

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

async function mockDocuments(page, documents) {
  const byId = new Map(documents.map((row) => [row.id, row]));

  await page.route('**/api/v1/documents**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/documents') {
      await json(route, 200, documents);
      return;
    }

    const linksMatch = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/links$/);
    if (method === 'GET' && linksMatch) {
      await json(route, 200, []);
      return;
    }

    const detailMatch = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)$/);
    if (method === 'GET' && detailMatch && byId.has(detailMatch[1])) {
      await json(route, 200, byId.get(detailMatch[1]));
      return;
    }

    await route.fulfill({ status: 404, body: `unexpected ${method} ${url.pathname}` });
  });
}

async function mockEvents(page, respond) {
  await page.route(EVENTS, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    await respond({ route, url, request });
  });
}

test('requests the selected document aggregate with the tenant header and limit', async ({ page }) => {
  const requests = [];

  await mockDocuments(page, [document()]);
  await mockEvents(page, async ({ route, url, request }) => {
    requests.push({
      method: request.method(),
      path: url.pathname,
      limit: url.searchParams.get('limit'),
      headers: request.headers()
    });
    await json(route, 200, { aggregateId: DOCUMENT_ID, limit: 50, items: [] });
  });

  await page.goto(`/?record=${DOCUMENT_ID}`);
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000001' })).toBeVisible();

  // Selection alone fetches the timeline, before the Activity tab is opened.
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].method).toBe('GET');
  expect(requests[0].path).toBe(`/api/v1/events/aggregate/${DOCUMENT_ID}`);
  expect(requests[0].limit).toBe('50');
  expect(requests[0].headers['x-eia-tenant']).toBe(TENANT);

  // The card's own Refresh re-reads the same aggregate without changing selection.
  await page.getByRole('tab', { name: 'Activity' }).click();
  const card = page.getByTestId('document-activity');
  await card.getByRole('button', { name: 'Refresh activity timeline' }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].path).toBe(`/api/v1/events/aggregate/${DOCUMENT_ID}`);
  expect(requests[1].limit).toBe('50');
  expect(requests[1].headers['x-eia-tenant']).toBe(TENANT);
});

test('renders newest first with readable type, status, version, timestamp, and facts', async ({ page }) => {
  const requests = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  await mockDocuments(page, [document()]);
  await mockEvents(page, async ({ route, url }) => {
    requests.push(url.pathname);
    if (requests.length === 1) await firstGate;
    // Deliberately oldest-first: the card must present newest-first.
    await json(route, 200, {
      aggregateId: DOCUMENT_ID,
      limit: 50,
      items: [createdEvent(), statusChangedEvent()]
    });
  });

  try {
    await page.goto(`/?record=${DOCUMENT_ID}`);
    await expect(page.getByRole('heading', { name: 'DOC-2026-0000001' })).toBeVisible();
    await page.getByRole('tab', { name: 'Activity' }).click();

    const card = page.getByTestId('document-activity');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('activity-loading')).toBeVisible();
    await expect(card.getByTestId('activity-count')).toHaveText('…');
    releaseFirst();

    await expect(card.getByTestId('activity-count')).toHaveText('2 events');
    const items = card.getByTestId('activity-item');
    await expect(items).toHaveCount(2);

    const newest = items.nth(0);
    await expect(newest.getByTestId('activity-type')).toHaveText('Document status changed');
    await expect(newest.getByTestId('activity-status')).toHaveText('PROCESSED');
    await expect(newest.getByTestId('activity-status')).toHaveClass(/green/);
    await expect(newest.getByTestId('activity-time')).toHaveAttribute(
      'dateTime',
      '2026-10-19T09:30:00Z'
    );
    await expect(newest.getByTestId('activity-time')).toContainText('Oct 19, 2026');
    await expect(newest.getByTestId('activity-version')).toHaveText('Version 1');
    await expect(newest.getByTestId('activity-fact-status')).toContainText('RECEIVED → ACTIVE');
    await expect(newest.getByTestId('activity-raw-type')).toHaveText(
      'document.document.status-changed'
    );

    const oldest = items.nth(1);
    await expect(oldest.getByTestId('activity-type')).toHaveText('Document created');
    await expect(oldest.getByTestId('activity-status')).toHaveText('PROCESSED');
    await expect(oldest.getByTestId('activity-version')).toHaveText('Version 0');
    await expect(oldest.getByTestId('activity-fact-document-type')).toContainText(
      'Document type POLICY'
    );
    await expect(oldest.getByTestId('activity-fact-classification')).toContainText(
      'Classification CONFIDENTIAL'
    );
    await expect(oldest.getByTestId('activity-fact-retention')).toContainText(
      'Retention until 2036-10-19'
    );
    await expect(oldest.getByTestId('activity-fact-status')).toContainText('Status RECEIVED');
  } finally {
    releaseFirst();
  }
});

test('shows the card-local empty state and the event-source context note', async ({ page }) => {
  await mockDocuments(page, [document()]);
  await mockEvents(page, async ({ route }) => {
    await json(route, 200, { aggregateId: DOCUMENT_ID, limit: 50, items: [] });
  });

  await page.goto(`/?record=${DOCUMENT_ID}`);
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('document-activity');
  await expect(card.getByTestId('activity-count')).toHaveText('0 events');
  await expect(card.getByTestId('activity-empty')).toContainText(
    'No activity has been recorded for this document yet.'
  );
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(card.getByTestId('activity-context-note')).toContainText('Event-derived timeline');
  await expect(card.getByTestId('activity-context-note')).toContainText('append-only');
  await expect(card.getByTestId('activity-context-note')).toContainText('source of truth');
  await expect(page.getByTestId('record-status')).toHaveText('ACTIVE');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contains a 503 from the event service inside the activity card', async ({ page }) => {
  await mockDocuments(page, [document()]);
  await mockEvents(page, async ({ route }) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://errors.eia-open-insurance.example/platform/event-store-unavailable',
        title: 'Event store unavailable',
        status: 503,
        code: 'EVENT_STORE_UNAVAILABLE',
        detail: 'The event service is unavailable; retry later.'
      })
    });
  });

  await page.goto(`/?record=${DOCUMENT_ID}`);
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('document-activity');
  await expect(card.getByTestId('activity-error')).toContainText(
    'Activity timeline is temporarily unavailable.'
  );
  await expect(card.getByTestId('activity-count')).toHaveText('0 events');
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(page.getByTestId('record-status')).toHaveText('ACTIVE');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // The rest of the record still works: Overview remains readable.
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('region', { name: 'Document details' })).toBeVisible();
});

test('summarizes status and link facts from event payloads', async ({ page }) => {
  await mockDocuments(page, [document()]);
  await mockEvents(page, async ({ route }) => {
    await json(route, 200, {
      aggregateId: DOCUMENT_ID,
      limit: 50,
      items: [linkAddedEvent(), statusChangedEvent()]
    });
  });

  await page.goto(`/?record=${DOCUMENT_ID}`);
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const items = page.getByTestId('activity-item');
  await expect(items).toHaveCount(2);

  const link = items.nth(0);
  await expect(link.getByTestId('activity-type')).toHaveText('Document link added');
  await expect(link.getByTestId('activity-status')).toHaveText('PROCESSED');
  await expect(link.getByTestId('activity-version')).toHaveText('Version 3');
  await expect(link.getByTestId('activity-fact-linked-type')).toContainText(
    'Linked type DIRECT_CLAIM'
  );
  await expect(link.getByTestId('activity-fact-linked-reference')).toContainText(
    'Linked reference CLM-2026-0000001'
  );

  const statusChange = items.nth(1);
  await expect(statusChange.getByTestId('activity-type')).toHaveText('Document status changed');
  await expect(statusChange.getByTestId('activity-fact-status')).toContainText(
    'RECEIVED → ACTIVE'
  );
});

test('refetches activity when another document is selected', async ({ page }) => {
  const first = document();
  const second = document({
    id: SECOND_DOCUMENT_ID,
    documentNumber: 'DOC-2026-0000002',
    title: 'Signed endorsement',
    documentType: 'ENDORSEMENT',
    status: 'RECEIVED',
    version: 1
  });
  const requests = [];

  await mockDocuments(page, [first, second]);
  await mockEvents(page, async ({ route, url, request }) => {
    requests.push({
      path: url.pathname,
      limit: url.searchParams.get('limit'),
      headers: request.headers()
    });
    const documentId = url.pathname.split('/').pop();
    if (documentId === SECOND_DOCUMENT_ID) {
      await json(route, 200, {
        aggregateId: SECOND_DOCUMENT_ID,
        limit: 50,
        items: [
          aggregateEvent({
            eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee4',
            eventType: 'document.document.updated',
            occurredAt: '2026-10-20T08:00:00Z',
            aggregateVersion: 2,
            aggregateId: SECOND_DOCUMENT_ID,
            data: { from: 'RECEIVED', to: 'ACTIVE', version: 1 }
          })
        ]
      });
      return;
    }
    await json(route, 200, {
      aggregateId: DOCUMENT_ID,
      limit: 50,
      items: [createdEvent()]
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000001' })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].path).toBe(`/api/v1/events/aggregate/${DOCUMENT_ID}`);

  await page.getByRole('tab', { name: 'Activity' }).click();
  const card = page.getByTestId('document-activity');
  await expect(card.getByTestId('activity-item')).toHaveCount(1);
  await expect(card.getByTestId('activity-type')).toHaveText('Document created');

  await page.getByRole('button', { name: 'Open record DOC-2026-0000002' }).click();
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000002' })).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].path).toBe(`/api/v1/events/aggregate/${SECOND_DOCUMENT_ID}`);
  expect(requests[1].limit).toBe('50');
  expect(requests[1].headers['x-eia-tenant']).toBe(TENANT);

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(card.getByTestId('activity-count')).toHaveText('1 event');
  await expect(card.getByTestId('activity-type')).toHaveText('Document updated');
  await expect(card.getByTestId('activity-fact-status')).toContainText('RECEIVED → ACTIVE');
});

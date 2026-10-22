/**
 * Related notifications for a document record.
 *
 * A notification is a delivery artifact owned by the Notifications vertical.
 * The document reads the messages whose `sourceType`/`sourceId` point at the
 * selected document and shows them as read-only context: the card never
 * creates, sends, delivers, or acknowledges a notification, and a failed
 * lookup never blocks the document record itself.
 *
 * The list endpoint is `GET /api/v1/notifications?sourceType=DOCUMENT&sourceId=
 * <documentId>`. Notifications is tenant-scoped rather than book-scoped, so the
 * caller sends only the tenant header owned by `request`.
 */

/** The source linkage Notifications stores for a message sent from a document. */
export const DOCUMENT_NOTIFICATION_SOURCE_TYPE = 'DOCUMENT';

/** The Overview preview shows only the newest few; the count keeps the total. */
export const RELATED_NOTIFICATION_LIMIT = 3;

/** Builds GET /api/v1/notifications?sourceType=DOCUMENT&sourceId=<documentId>. */
export function documentNotificationsEndpoint(documentId) {
  const id = String(documentId || '').trim();
  if (!id) return '';
  const params = new URLSearchParams();
  params.set('sourceType', DOCUMENT_NOTIFICATION_SOURCE_TYPE);
  params.set('sourceId', id);
  return `/api/v1/notifications?${params.toString()}`;
}

/** A notification opens in its own workbench by record id. */
export function notificationRecordHref(notificationId) {
  const id = String(notificationId || '').trim();
  if (!id) return '/notifications';
  return `/notifications?record=${encodeURIComponent(id)}`;
}

/**
 * The Notifications queue accepts `sourceType`/`sourceId` as a server-side
 * filter, so "view all" keeps this document's scope instead of opening an
 * unfiltered queue or a text search.
 */
export function documentNotificationsQueueHref(documentId) {
  const id = String(documentId || '').trim();
  if (!id) return '/notifications';
  const params = new URLSearchParams();
  params.set('sourceType', DOCUMENT_NOTIFICATION_SOURCE_TYPE);
  params.set('sourceId', id);
  return `/notifications?${params.toString()}`;
}

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/**
 * The API is already source-filtered, but Notifications is a shared service and
 * the document must not present another record's messages. A row that names a
 * different source is dropped; a row that omits the linkage is kept because the
 * server-side filter is authoritative for legacy data. A missing `sourceType`
 * is tolerated only when the id matches, since the API writes the pair together.
 */
function belongsToDocument(notification, documentId) {
  const expectedId = String(documentId || '').trim().toLowerCase();
  if (!expectedId) return true;
  const sourceId = String(notification?.sourceId || '').trim().toLowerCase();
  if (!sourceId) return true;
  if (sourceId !== expectedId) return false;
  const sourceType = String(notification?.sourceType || '').trim().toUpperCase();
  return !sourceType || sourceType === DOCUMENT_NOTIFICATION_SOURCE_TYPE;
}

/**
 * Only the fields the Overview card renders are normalized. A row without an
 * id cannot be linked, so it is dropped instead of shown as unlinked noise.
 */
function normalizeNotification(notification) {
  if (!notification || typeof notification !== 'object' || Array.isArray(notification)) {
    return null;
  }
  const id = firstText(notification.id, notification.notificationId);
  if (!id) return null;
  return {
    id,
    notificationNumber: firstText(
      notification.notificationNumber,
      notification.number,
      notification.reference,
      notification.subject,
      notification.title,
      id
    ),
    subject: firstText(notification.subject, notification.title, notification.notificationSubject),
    notificationType: firstText(notification.notificationType, notification.type),
    status: firstText(notification.status).toUpperCase(),
    createdAt: firstText(notification.createdAt, notification.createdOn, notification.created),
    sourceType: firstText(notification.sourceType).toUpperCase(),
    sourceId: firstText(notification.sourceId)
  };
}

/**
 * Tolerant read of GET /api/v1/notifications: a bare array or an `{items}`
 * envelope during rollout. Rows are newest-first so the preview is stable even
 * when the service returns an older-first page.
 */
export function documentNotifications(payload, documentId) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : [];
  return rows
    .map((row) => normalizeNotification(row))
    .filter((row) => row !== null && belongsToDocument(row, documentId))
    .sort(compareNewestFirst);
}

/**
 * The count is the total number of related notifications, which can be larger
 * than the three-row preview. A page envelope may carry `total`; a bare array
 * and a truncated payload fall back to the rows that are present.
 */
export function documentNotificationCount(payload, items) {
  const rows = Array.isArray(items) ? items : [];
  const total = Number(payload?.total);
  return Number.isInteger(total) && total >= rows.length ? total : rows.length;
}

function createdMillis(notification) {
  const parsed = Date.parse(notification?.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Newest first. The notification number breaks same-instant ties so the
 * three-row preview is deterministic across reloads.
 */
function compareNewestFirst(left, right) {
  const timeDiff = createdMillis(right) - createdMillis(left);
  if (timeDiff !== 0) return timeDiff;
  return String(right?.notificationNumber || '')
    .localeCompare(String(left?.notificationNumber || ''));
}

export function newestDocumentNotifications(items, limit = RELATED_NOTIFICATION_LIMIT) {
  const size = Number.isInteger(limit) && limit > 0 ? limit : RELATED_NOTIFICATION_LIMIT;
  return [...(Array.isArray(items) ? items : [])].sort(compareNewestFirst).slice(0, size);
}

/**
 * Mirrors the Notifications workbench status tone so a SENT/DELIVERED message
 * reads as successful and a FAILED/CANCELLED one reads as a delivery problem.
 */
export function notificationStatusTone(status) {
  const normalized = String(status || '').toUpperCase();
  if (['SENT', 'DELIVERED', 'READ', 'ACKNOWLEDGED', 'ACTIONED'].includes(normalized)) {
    return 'green';
  }
  if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(normalized)) {
    return 'red';
  }
  if (['CREATED', 'QUEUED', 'SUPPRESSED'].includes(normalized)) {
    return 'amber';
  }
  return 'blue';
}

/** UTC keeps the card stable in tests and across operator time zones. */
export function formatNotificationTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  }).format(date);
}

/** The card owns its own request state so the document record never waits on it. */
export function emptyDocumentNotificationsState() {
  return { recordId: '', items: [], count: 0, loading: false, error: '' };
}

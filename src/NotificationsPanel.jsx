import React from 'react';
import { navigate } from './navigation.js';
import {
  RELATED_NOTIFICATION_LIMIT,
  documentNotificationsQueueHref,
  formatNotificationTimestamp,
  newestDocumentNotifications,
  notificationRecordHref,
  notificationStatusTone
} from './notifications.js';

/**
 * Opens a cross-remote link through the shell-aware navigate helper while
 * leaving modified clicks (new tab, new window, download) to the browser.
 */
function openLink(event) {
  if (
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
  ) {
    return;
  }
  const href = event.currentTarget.getAttribute('href');
  if (!href) return;
  event.preventDefault();
  navigate(href);
}

/**
 * Related notifications for the selected document. Notifications are a
 * read-only projection: they are delivered because the document changed, but
 * Notifications owns routing, delivery, escalation, and acknowledgement. The
 * card owns its loading, empty, and error states, so a slow or unavailable
 * Notifications service never blocks or fails the document record.
 */
export default function NotificationsPanel({
  documentId,
  items = [],
  count = 0,
  loading = false,
  error = ''
}) {
  const newest = newestDocumentNotifications(items, RELATED_NOTIFICATION_LIMIT);
  const countLabel = loading
    ? '…'
    : error
      ? '—'
      : `${count} notification${count === 1 ? '' : 's'}`;

  return (
    <section
      className="eia-card"
      id="related-notifications"
      aria-label="Related notifications"
      data-testid="related-notifications"
      style={{ marginTop: 14 }}
    >
      <div className="eia-section-title" style={{ marginTop: 0 }}>
        <h3>Related notifications</h3>
        <span className="eia-badge" data-testid="related-notifications-count">
          {countLabel}
        </span>
      </div>

      <p className="eia-muted" style={{ margin: '4px 0 0' }}>
        Notifications are delivery artifacts, not business facts. This card lists only messages
        whose source is this document; it never sends or changes one.
      </p>

      {loading && (
        <p
          className="eia-muted"
          data-testid="related-notifications-loading"
          role="status"
          style={{ margin: '8px 0 0' }}
        >
          Loading related notifications…
        </p>
      )}

      {!loading && error && (
        <p
          className="eia-muted"
          data-testid="related-notifications-error"
          style={{ margin: '8px 0 0' }}
        >
          Related notifications are temporarily unavailable ({error}). The document record is
          unaffected.
        </p>
      )}

      {!loading && !error && items.length === 0 && (
        <p
          className="eia-muted"
          data-testid="related-notifications-empty"
          style={{ margin: '8px 0 0' }}
        >
          No notifications reference this document yet.
        </p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="eia-table-wrap" style={{ marginTop: 10 }}>
          <table className="eia-table" aria-label="Related notifications">
            <thead>
              <tr>
                <th>Notification</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {newest.map((notification) => (
                <tr key={notification.id} data-testid="related-notification-row">
                  <td>
                    <a
                      className="eia-mono"
                      href={notificationRecordHref(notification.id)}
                      data-testid={`related-notification-link-${notification.id}`}
                      title={`Open notification ${notification.notificationNumber}`}
                      onClick={openLink}
                    >
                      {notification.notificationNumber}
                    </a>
                  </td>
                  <td data-testid="related-notification-subject">
                    {notification.subject || notification.notificationType || '—'}
                  </td>
                  <td>
                    <span
                      className={`eia-pill ${notificationStatusTone(notification.status)}`}
                      data-testid="related-notification-status"
                    >
                      {notification.status || '—'}
                    </span>
                  </td>
                  <td data-testid="related-notification-created">
                    <time
                      dateTime={notification.createdAt || undefined}
                      title={notification.createdAt || undefined}
                    >
                      {formatNotificationTimestamp(notification.createdAt)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && count > newest.length && (
        <p
          className="eia-muted"
          data-testid="related-notifications-more"
          style={{ margin: '8px 0 0' }}
        >
          Showing the newest {newest.length} of {count}.
        </p>
      )}

      <p className="eia-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
        <a
          href={documentNotificationsQueueHref(documentId)}
          data-testid="related-notifications-view-all"
          onClick={openLink}
        >
          View all notifications
        </a>{' '}
        — opens the Notifications queue filtered to this document.
      </p>
    </section>
  );
}

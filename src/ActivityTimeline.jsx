import React from 'react';
import {
  eventRecordVersion,
  eventStatusTone,
  formatEventTimestamp,
  payloadFacts,
  readableEventType
} from './events.js';

function ActivityItem({ event }) {
  const status = event?.status ? String(event.status) : 'UNKNOWN';
  const facts = payloadFacts(event);
  const version = eventRecordVersion(event);

  return (
    <li className="eia-timeline-item" data-testid="activity-item">
      <div className="eia-timeline-head">
        <time
          className="eia-activity-time"
          dateTime={event?.occurredAt || undefined}
          title={event?.occurredAt || undefined}
          data-testid="activity-time"
        >
          {formatEventTimestamp(event?.occurredAt)}
        </time>
        <strong className="eia-activity-type" data-testid="activity-type">
          {readableEventType(event?.eventType)}
        </strong>
        <span className={`eia-pill ${eventStatusTone(status)}`} data-testid="activity-status">
          {status}
        </span>
        <span className="eia-activity-version" data-testid="activity-version">
          Version {version || '—'}
        </span>
      </div>

      {facts.length > 0 && (
        <ul className="eia-activity-facts" aria-label="Event payload summary">
          {facts.map((fact) => (
            <li
              key={fact.key}
              className="eia-activity-fact"
              data-testid={`activity-fact-${fact.key}`}
            >
              <span className="eia-activity-fact-label">{fact.label}</span>{' '}
              <b>{fact.value}</b>
            </li>
          ))}
        </ul>
      )}

      <p className="eia-activity-raw eia-mono" data-testid="activity-raw-type">
        {event?.eventType || 'unknown'}
      </p>
    </li>
  );
}

/**
 * The document activity card. It is a read-only projection of the platform
 * event stream and stays card-local: loading, empty, and error states never
 * block the document record beside it.
 */
export default function ActivityTimeline({ items = [], loading = false, error = '', onRefresh }) {
  const countLabel = loading
    ? '…'
    : `${items.length} ${items.length === 1 ? 'event' : 'events'}`;

  return (
    <section
      className="eia-card eia-activity"
      data-testid="document-activity"
      aria-label="Activity timeline"
    >
      <div className="eia-toolbar" style={{ marginBottom: 4 }}>
        <span className="eia-muted" data-testid="activity-count">{countLabel}</span>
        <span className="spacer" />
        <button
          type="button"
          className="eia-btn-secondary"
          data-testid="activity-refresh"
          onClick={() => {
            if (onRefresh) onRefresh();
          }}
          disabled={loading}
          aria-label="Refresh activity timeline"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p
        className="eia-muted eia-activity-note"
        data-testid="activity-context-note"
        style={{ margin: 0 }}
      >
        Event-derived timeline: entries come from immutable document events, are append-only, and
        are never edited or removed. The document record remains the source of truth for its current
        metadata, classification, and lifecycle.
      </p>

      {loading ? (
        <p className="eia-muted" data-testid="activity-loading" style={{ margin: '12px 0 0' }}>
          Loading activity…
        </p>
      ) : error ? (
        <p className="eia-muted" data-testid="activity-error" style={{ margin: '12px 0 0' }}>
          {error}
        </p>
      ) : items.length === 0 ? (
        <div className="eia-empty" data-testid="activity-empty" style={{ marginTop: 12 }}>
          No activity has been recorded for this document yet.
        </div>
      ) : (
        <ol
          className="eia-timeline"
          data-testid="activity-timeline"
          aria-label="Document activity timeline"
        >
          {items.map((event, index) => (
            <ActivityItem
              key={event?.eventId || `activity-${event?.aggregateVersion ?? index}-${index}`}
              event={event}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

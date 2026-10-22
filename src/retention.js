/**
 * Retention, legal hold, and disposition helpers.
 *
 * The Document API owns the state; this module only reads the public record and
 * decides what the workbench may offer. A legal hold suspends disposition, so
 * the two projections are always read together.
 *
 * The projection is accepted in the canonical flat shape (`legalHold`,
 * `holdReason`, `heldAt`, `statusBeforeHold`, `disposedAt`) and in the aliases
 * an expert, a nested hold object, or an older deployment may return. Missing
 * facts are reported as empty strings rather than guessed, because a hold or a
 * disposition is an audited legal fact and must not be invented by the UI.
 */

export const HOLD_REASON_MAX_LENGTH = 1000;

const HELD_STATUS_VALUES = new Set(['ON_HOLD', 'ONHOLD', 'HELD', 'LEGAL_HOLD', 'ACTIVE_HOLD']);
const DISPOSED_VALUES = new Set(['DISPOSED', 'DESTROYED', 'PURGED']);

function text(value) {
  if (value === null || value === undefined || typeof value === 'object') return '';
  return String(value).trim();
}

function firstText(...values) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return '';
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return undefined;
}

function asBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'held', 'on', 'active'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'released', 'off', 'inactive', 'none'].includes(normalized)) {
    return false;
  }
  return undefined;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizedStatus(value) {
  return text(value).toUpperCase().replace(/[\s-]+/g, '_');
}

/**
 * Reads the legal-hold projection.
 *
 * `held` is true when the flag is true, when the hold projection says HELD, or
 * when the document lifecycle is already ON_HOLD. The last case keeps an older
 * projection (flag omitted, status present) from offering a second hold.
 */
export function holdDetails(document = {}) {
  const source = asRecord(document) || {};
  const legalHoldRecord = asRecord(source.legalHold) || asRecord(source.legal_hold);
  const hold = asRecord(source.hold) || legalHoldRecord || {};
  const hasHoldRecord = Object.keys(hold).length > 0;
  const holdStatus = normalizedStatus(firstValue(
    source.holdStatus,
    source.hold_status,
    source.legalHoldStatus,
    source.legal_hold_status,
    hold.status,
    hold.holdStatus
  ));
  const documentStatus = normalizedStatus(source.status);
  const nestedActive = hasHoldRecord && HELD_STATUS_VALUES.has(normalizedStatus(hold.status));
  // Any affirmative projection wins; a stale explicit false on one alias must
  // not hide an active hold reported by another.
  const heldFlags = [
    source.legalHold,
    source.legal_hold,
    source.legalHoldFlag,
    source.legal_hold_flag,
    source.legalHoldActive,
    source.legal_hold_active,
    source.holdActive,
    source.hold_active,
    source.onHold,
    source.on_hold,
    source.held,
    source.isHeld,
    source.is_held,
    source.hold,
    hold.active,
    hold.held,
    hold.onHold
  ]
    .map(asBoolean)
    .filter((value) => value !== undefined);

  const held = heldFlags.includes(true)
    || HELD_STATUS_VALUES.has(holdStatus)
    || HELD_STATUS_VALUES.has(documentStatus)
    || nestedActive;

  return {
    held,
    status: held ? 'HELD' : 'CLEARED',
    reason: firstText(
      source.holdReason,
      source.hold_reason,
      source.legalHoldReason,
      source.legal_hold_reason,
      hold.reason,
      hold.holdReason
    ),
    heldAt: firstText(
      source.heldAt,
      source.held_at,
      source.heldDate,
      source.held_date,
      source.heldOn,
      source.held_on,
      source.holdDate,
      source.hold_date,
      source.holdStartedAt,
      source.hold_started_at,
      source.holdAppliedAt,
      source.hold_applied_at,
      source.legalHoldSince,
      source.legal_hold_since,
      hold.heldAt,
      hold.held_at,
      hold.startedAt,
      hold.started_at,
      hold.appliedAt,
      hold.createdAt
    ),
    statusBeforeHold: firstText(
      source.statusBeforeHold,
      source.status_before_hold,
      source.holdPreviousStatus,
      source.hold_previous_status,
      source.preHoldStatus,
      source.pre_hold_status,
      source.previousStatus,
      source.previous_status,
      source.priorStatus,
      source.prior_status,
      hold.statusBeforeHold,
      hold.previousStatus,
      hold.priorStatus
    )
  };
}

/** Reads the disposition projection: whether it happened and when. */
export function dispositionDetails(document = {}) {
  const source = asRecord(document) || {};
  const disposition = asRecord(source.disposition) || asRecord(source.disposal) || {};
  const statuses = [
    source.status,
    source.recordState,
    source.record_state,
    source.dispositionStatus,
    source.disposition_status,
    disposition.status
  ].map(normalizedStatus);
  const disposedFlags = [
    source.disposed,
    disposition.disposed,
    disposition.done
  ]
    .map(asBoolean)
    .filter((value) => value !== undefined);

  return {
    disposed: disposedFlags.includes(true) || statuses.some((status) => DISPOSED_VALUES.has(status)),
    disposedAt: firstText(
      source.disposedAt,
      source.disposed_at,
      source.disposedDate,
      source.disposed_date,
      source.dispositionDate,
      source.disposition_date,
      source.dispositionTimestamp,
      source.disposition_timestamp,
      source.disposedOn,
      source.disposed_on,
      source.dispositionAt,
      source.disposition_at,
      disposition.date,
      disposition.disposedAt,
      disposition.disposed_at,
      disposition.at,
      disposition.disposedOn
    )
  };
}

/**
 * Reads a date as a local calendar date. `YYYY-MM-DD` values (the API's
 * retentionUntil shape) are parsed component-wise so they never shift a day in
 * a negative-offset timezone; timestamps keep their local calendar date.
 */
function calendarDate(value) {
  const raw = text(value);
  if (!raw) return null;
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return date;
    }
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

/** True on and after the retention end date (the date is inclusive). */
export function retentionReached(retentionUntil, now = new Date()) {
  const date = calendarDate(retentionUntil);
  if (!date) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getTime() <= today.getTime();
}

/**
 * Everything the Retention tab needs for one document. `canDispose` is the
 * single gate for the destructive action: the retention date must be reached
 * and no hold may stand. The block strings are shown as the disabled
 * explanations next to each action.
 */
export function retentionView(document = {}, now = new Date()) {
  const source = asRecord(document) || {};
  const hold = holdDetails(source);
  const disposition = dispositionDetails(source);
  const retentionUntil = text(source.retentionUntil || source.retention_date || source.retentionDate);
  const reached = retentionReached(retentionUntil, now);

  let disposeBlock = '';
  if (disposition.disposed) {
    disposeBlock =
      'This document has already been disposed. Disposition is irreversible; the stored content was destroyed and its tombstone, the audit trail, and the disposition certificate are retained.';
  } else if (hold.held) {
    disposeBlock = 'Legal hold blocks disposition. Release the hold before disposing this record.';
  } else if (!retentionUntil) {
    disposeBlock = 'Disposition is unavailable because no retention date is set for this document.';
  } else if (!reached) {
    disposeBlock = `Disposition is unavailable until the retention date of ${retentionUntil} is reached.`;
  }

  let holdBlock = '';
  if (disposition.disposed) {
    holdBlock = 'A disposed record cannot be placed under legal hold.';
  } else if (hold.held) {
    holdBlock = 'This document is already under legal hold. Release the hold to restore its prior status.';
  }

  return {
    hold,
    disposition,
    retentionUntil,
    reached,
    canPlaceHold: !holdBlock,
    canReleaseHold: hold.held && !disposition.disposed,
    canDispose: !disposeBlock,
    holdBlock,
    releaseBlock: hold.held ? '' : 'This document is not under legal hold.',
    disposeBlock
  };
}

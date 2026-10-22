/**
 * Document association links.
 *
 * A document is evidence: it may point at a claim, policy, contract, party, or
 * payment, but the linked record stays owned by its vertical and the document
 * never mutates it. `linkedType` decides which search endpoint feeds the
 * picker and which shell route opens the linked record.
 */
import { recordHref } from './navigation.js';

export const LINK_REFERENCE_MAX_LENGTH = 64;

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LINK_TYPES = [
  {
    value: 'DIRECT_CLAIM',
    label: 'Direct claim',
    endpoint: '/api/v1/claims/search',
    detail: '/api/v1/claims',
    labelFields: ['claimNumber'],
    book: 'DIRECT',
    route: 'direct-claims',
    tone: 'direct'
  },
  {
    value: 'ASSUMED_CLAIM',
    label: 'Assumed claim',
    endpoint: '/api/v1/assumed-claims/search',
    detail: '/api/v1/assumed-claims/claims',
    labelFields: ['assumedClaimNumber', 'cedentClaimNumber'],
    book: 'ASSUMED',
    route: 'assumed-claims',
    tone: 'assumed'
  },
  {
    value: 'POLICY',
    label: 'Policy',
    endpoint: '/api/v1/policies/search',
    detail: '/api/v1/policies',
    labelFields: ['policyNumber'],
    book: 'DIRECT',
    route: 'policy',
    tone: 'direct'
  },
  {
    value: 'CONTRACT',
    label: 'Contract',
    endpoint: '/api/v1/contracts/search',
    detail: '/api/v1/contracts',
    labelFields: ['contractNumber'],
    book: 'ASSUMED',
    route: 'contract',
    tone: 'assumed'
  },
  {
    value: 'PARTY',
    label: 'Party',
    endpoint: '/api/v1/parties/search',
    detail: '/api/v1/parties',
    labelFields: ['partyNumber', 'displayName'],
    book: '',
    route: 'party',
    tone: ''
  },
  {
    value: 'PAYMENT',
    label: 'Payment',
    endpoint: '/api/v1/payments/search',
    detail: '/api/v1/payments',
    labelFields: ['paymentNumber'],
    book: '',
    route: 'payment',
    tone: ''
  },
  {
    value: 'OTHER',
    label: 'Other reference',
    endpoint: '',
    book: '',
    route: '',
    tone: 'warn',
    manual: true
  }
];

const LINK_TYPE_BY_VALUE = new Map(LINK_TYPES.map((type) => [type.value, type]));

export function normalizeLinkedType(value) {
  const type = String(value || '').trim().toUpperCase();
  return LINK_TYPE_BY_VALUE.has(type) ? type : '';
}

/** Definition backing the picker, route, and badge for a link type. */
export function linkTypeDefinition(value) {
  return LINK_TYPE_BY_VALUE.get(normalizeLinkedType(value)) || null;
}

export function linkTypeLabel(value) {
  const definition = linkTypeDefinition(value);
  if (definition) return definition.label;
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  return raw
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function linkTypeEndpoint(value) {
  return linkTypeDefinition(value)?.endpoint || '';
}

export function linkTypeBook(value) {
  return linkTypeDefinition(value)?.book || '';
}

export function linkTypeRoute(value) {
  return linkTypeDefinition(value)?.route || '';
}

/**
 * Detail read for the owning vertical, or '' when the type has no detail
 * endpoint (OTHER is a free reference). The document never writes here; the
 * read only resolves a display label for an already stored link.
 */
export function linkTypeDetailUrl(value, linkedId) {
  const definition = linkTypeDefinition(value);
  const id = String(linkedId || '').trim();
  if (!definition?.detail || !id) return '';
  return `${definition.detail}/${encodeURIComponent(id)}`;
}

/** Stable cache key for one link's hydrated display label. */
export function linkLabelKey(link) {
  const linkedType =
    normalizeLinkedType(link?.linkedType) ||
    String(link?.linkedType || '').trim().toUpperCase();
  return `${linkedType}:${String(link?.linkedId || '').trim()}`;
}

function detailText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Reads the business key from a linked record's detail projection. Each
 * vertical names its human reference differently; the trailing fields cover
 * older projections and generic envelopes.
 */
export function linkDetailLabel(linkedType, detail) {
  const source =
    detail && typeof detail === 'object'
      ? detail.item || detail.record || detail
      : null;
  if (!source || typeof source !== 'object') return '';

  const definition = linkTypeDefinition(linkedType);
  const fields = [
    ...(definition?.labelFields || []),
    'linkedReference',
    'reference',
    'businessKey',
    'displayName',
    'name',
    'title'
  ];
  for (const field of fields) {
    const text = detailText(source[field]);
    if (text) return text;
  }
  return '';
}

export function linkTypeTone(value) {
  return linkTypeDefinition(value)?.tone || '';
}

export function isUuid(value) {
  return UUID_PATTERN.test(String(value || '').trim());
}

/**
 * Normalizes a link returned by the API. `linkedReference` is the business key
 * shown in the table; `id` is the association id used by DELETE.
 */
export function normalizeLink(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const linkedType =
    normalizeLinkedType(source.linkedType || source.linkType) ||
    String(source.linkedType || source.linkType || source.subjectType || '')
      .trim()
      .toUpperCase();
  const linkedId = String(source.linkedId || source.subjectId || source.recordId || '').trim();
  const linkedReference = String(
    source.linkedReference ||
      source.reference ||
      source.linkedLabel ||
      source.label ||
      source.subjectBusinessKey ||
      ''
  ).trim();
  const addedAt = source.addedAt || source.createdAt || source.addedDate || '';
  return {
    id: String(source.id || source.linkId || '').trim(),
    linkedType,
    linkedId,
    linkedReference,
    addedAt
  };
}

/**
 * Links belonging to one document record, whether the projection embedded them
 * or the workbench folded the association collection into the record.
 */
export function documentLinks(document) {
  const rows = Array.isArray(document?.links) ? document.links : [];
  return rows
    .map(normalizeLink)
    .filter((link) => link.linkedType || link.linkedId || link.linkedReference);
}

export function linkReference(link) {
  return link?.linkedReference || link?.linkedId || '';
}

/**
 * Display label for a link: the reference stored with the association, the
 * label hydrated from the owning vertical, or '' so the caller can fall back
 * to the short id.
 */
export function linkLabel(link, labels) {
  const stored = String(link?.linkedReference || '').trim();
  if (stored) return stored;
  const hydrated = labels?.[linkLabelKey(link)];
  return typeof hydrated === 'string' ? hydrated.trim() : '';
}

/** Shell route that opens the linked record, or '' when the type has no route. */
export function linkHref(link) {
  const route = linkTypeRoute(link?.linkedType);
  return route && link?.linkedId ? recordHref(route, link.linkedId) : '';
}

export function buildLinkPayload(form) {
  return {
    linkedType:
      normalizeLinkedType(form?.linkedType) ||
      String(form?.linkedType || '').trim().toUpperCase(),
    linkedId: String(form?.linkedId || '').trim(),
    linkedReference: String(form?.linkedReference || '').trim()
  };
}

/**
 * Client-side validation for the add-link form. The server remains the
 * authority (duplicate links are a 409); this only catches an incomplete form
 * before it leaves the browser.
 */
export function validateLinkForm(form) {
  const issues = [];
  const linkedType = normalizeLinkedType(form?.linkedType);
  const linkedId = String(form?.linkedId || '').trim();
  const reference = String(form?.linkedReference || '').trim();

  if (!linkedType) {
    issues.push('Select a linked record type.');
  }

  if (reference.length > LINK_REFERENCE_MAX_LENGTH) {
    issues.push(`The reference must be ${LINK_REFERENCE_MAX_LENGTH} characters or fewer.`);
  }

  if (linkedType === 'OTHER') {
    // The reference is an optional display label; the target UUID is the
    // identity the server requires for every link type, including OTHER.
    if (!linkedId) {
      issues.push('Enter the UUID of the linked record.');
    } else if (!isUuid(linkedId)) {
      issues.push('Enter a valid UUID for the linked record.');
    }
  } else if (linkedType) {
    if (!linkedId) {
      issues.push('Select a linked record.');
    } else if (!isUuid(linkedId)) {
      issues.push('The selected record id is not a valid UUID.');
    }
  }

  return issues;
}

export function emptyLinkForm(linkedType = 'DIRECT_CLAIM') {
  return { linkedType, linkedId: '', linkedReference: '' };
}

# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Automatic content tombstone on document disposition: a successful
  `POST /api/v1/documents/{id}/dispose` destroys the stored content on the
  backend, so the workbench now refreshes both the document and
  `GET /api/v1/documents/{id}/content/metadata` after the command. The **File**
  tab shows the retained content tombstone immediately (file name, hash, size,
  version, and deleted time) with downloads and content deletion disabled; a
  disposition that had no stored content stays in the "No file stored" empty
  state with no replacement upload, and no separate content `DELETE` is needed.
  The Lifecycle and Retention tabs state that disposition destroys the stored
  content while retaining the content and document audit metadata. Playwright
  covers the post-dispose metadata refetch, the tombstone, the no-content case,
  and a lagging metadata projection.
- Repository baseline.
- Document association links: the Associations tab lists linked records with type, reference,
  added date, and a shell route to the owning vertical. The add-link dialog uses a predictive
  `EntityPicker` per linked type (or a manual reference and UUID for `OTHER`), posts
  `/api/v1/documents/{id}/links`, and removes links with DELETE. Links are read from the
  document's association collection and rendered on the Overview as related records.
- Document activity timeline: the **Activity** tab renders
  `GET /api/v1/events/aggregate/{documentId}?limit=50` scoped by `X-EIA-Tenant`. Selecting a
  document fetches the card; rows show the occurred-at timestamp, a readable event name plus the
  raw event type, inbox status, record version, and payload facts (document type,
  classification, retention date, status transition, and linked type/reference when a link
  event is present). The card states that activity is event-derived and append-only and that
  the document record remains the source of truth, keeps loading, empty, and error states
  inside the card, refreshes on demand, and refetches whenever another document is selected.
  A 503 from the event service never blocks the document record. Playwright covers the
  aggregate path/limit/tenant header, newest-first rendering, the empty and 503 states,
  payload facts, and selection refetch.
- Document content version history: the **File** tab shows `currentVersion`
  from `GET /api/v1/documents/{id}/content/metadata` and a newest-first
  revision table (version, file name, type, size, short SHA-256, uploaded time,
  and Download). History reads `GET /api/v1/documents/{id}/content/versions`;
  each Download fetches
  `GET /api/v1/documents/{id}/content/versions/{version}` as an authorized blob
  without changing the current file. Uploads still append through the current
  content route and refresh both the metadata and history. An empty list has
  its own state, and history read/download failures stay inside the card.
  Playwright covers the current version, table order and columns, version
  download, upload refresh, empty history, and read/download errors.
- Document content upload/download: the **File** tab reads
  `GET /api/v1/documents/{id}/content/metadata` and shows the stored file name, media type,
  size, SHA-256, and upload time, or the "No file stored" empty state with an upload input and
  drag/drop. Uploads send raw bytes to `PUT /api/v1/documents/{id}/content` with
  `X-EIA-Tenant`, `Content-Type`, and `X-File-Name`, validate a 10 MiB client-side ceiling, and
  show byte-level progress. Downloads fetch the blob from `GET /api/v1/documents/{id}/content`
  through an object URL. The register-document dialog accepts an optional file and uploads it
  after creating the metadata; upload errors leave the registered document intact and are
  contained in the File tab. Playwright covers the upload headers/body, metadata rendering,
  download, empty state, oversized rejection, and failure states.
- Legal hold and disposition: the **Retention** tab shows the hold status, hold reason, held
  date, status before hold, disposition date, and disposition eligibility. "Place legal hold"
  opens a reason modal and posts `/api/v1/documents/{id}/hold`; "Release hold" posts
  `/api/v1/documents/{id}/hold/release`; "Dispose document" requires a red irreversible-action
  confirmation and posts `/api/v1/documents/{id}/dispose`. A hold blocks disposition, and a
  disposition destroys content while retaining the audit trail and disposition certificate.
  Ineligible actions are disabled with a visible explanation (already held, not held, already
  disposed, no retention date, or retention date not reached). The queue and record are updated
  from the command response, with the commanded facts filling in a 204 or narrow projection.
  Playwright covers place, release, dispose, blocked eligibility, and all three error paths.

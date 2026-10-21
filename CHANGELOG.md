# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

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

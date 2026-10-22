# eia-document-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-document-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Document
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Document federated remote: screens, widgets, record tabs, and transaction composition. Document ingestion, classification, retention, legal hold, print, e-signature, and e-discovery.

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Local run

```powershell
npm install
npm start
```

- Port: `3008`.
- Module Federation container `eia_document`, exposes `./App` from `remoteEntry.js`.
- Dev server proxies `/api` to `http://localhost:8096`.
- `npm run build` produces the production bundle in `dist/`.
- `npm test` runs the Playwright test; the API is mocked in the test.

## Content (evidence file)

A document's metadata remains the source of truth; its stored file is evidence
attached by the Document service:

- `PUT /api/v1/documents/{documentId}/content` receives the raw file bytes,
  with `Content-Type` and `X-File-Name` describing the file (never JSON).
- `GET /api/v1/documents/{documentId}/content` returns the authorized bytes.
- `GET /api/v1/documents/{documentId}/content/metadata` returns the file name,
  media type, size, SHA-256, upload timestamp, and `currentVersion`; a 404
  means no file is stored.
- `GET /api/v1/documents/{documentId}/content/versions` lists immutable
  revision metadata newest first.
- `GET /api/v1/documents/{documentId}/content/versions/{version}` returns the
  bytes of one retained revision with the same attachment headers as the
  current-file download.

The remote surfaces this in the **File** tab. With content, it renders the
current file metadata including `currentVersion` and a version-history table
(version, file name, type, size, short SHA-256, uploaded time, and a download
action per row). Uploading a new version replaces the current file, adds a
retained revision, and refreshes both the metadata and history. Without
content, it shows "No file stored" and offers an upload input and drag/drop.
Files are validated client-side at 10 MiB, upload progress is shown through
`XMLHttpRequest`, and read/upload/download failures stay contained in the tab.
The register-document dialog accepts an optional file and uploads it after the
metadata is created; a failed upload leaves the registered document intact and
switches to the File tab so it can be retried. `tests/content.spec.js` covers
the upload headers and raw body, metadata and current-version rendering,
history ordering and columns, version blob download, upload refresh, empty
history, version/read errors, metadata rendering, current download, empty
state, and oversized rejection.

Disposition also destroys the stored content. After a successful dispose the
workbench refreshes the document and `content/metadata` projections, so the
File tab immediately renders the retained content tombstone (file name, hash,
size, and version audit) with downloads disabled. A document that never stored
content stays in the empty state after disposition, with no replacement upload
offered. No separate content `DELETE` is issued after dispose.

## Retention, legal hold, and disposition

The **Retention** tab reads the retention and hold facts already carried by the
document record (`retentionUntil`, the legal-hold flag and reason, the held
date, `statusBeforeHold`, and `disposedAt`) and offers the governed actions:

- `POST /api/v1/documents/{documentId}/hold` with `{ "reason": "…" }` places a
  legal hold. The reason is required and travels with the audit trail.
- `POST /api/v1/documents/{documentId}/hold/release` releases the active hold;
  the record returns to the status it held before the hold.
- `POST /api/v1/documents/{documentId}/dispose` disposes the record after a red
  confirmation. Disposition is irreversible: the stored content is destroyed
  automatically and its file name, hash, size, and versions remain as a content
  tombstone, while the document metadata, audit trail, and disposition
  certificate are retained. No separate content deletion is required.

A legal hold blocks disposition. The dispose action is enabled only when a
retention date is set, that date has been reached, no hold is active, and the
record is not already disposed; otherwise the tab shows the disabled reason
inline and as the button title. A successful action updates the record in the
queue and the panel from the API response, falling back to the commanded facts
when the API answers 204 or a narrow projection, and refreshes the content
projection so the File tab shows the tombstone immediately. Place, release,
dispose, automatic content tombstoning, and their blocked, empty-content, and
error states are covered by `tests/retention.spec.js`.

## Related notifications

The **Overview** tab carries a read-only related-notifications card. It reads
`GET /api/v1/notifications?sourceType=DOCUMENT&sourceId=<documentId>` with
`X-EIA-Tenant` and no book header, and accepts either a bare array or an
`{items}` envelope (using `total` for the heading count when present). It shows
the full count and the newest three source-linked deliveries: notification
number linked to `/notifications?record=<id>`, subject, status pill, and created
time in UTC. Rows that name another document or another source type are
excluded. Loading, empty, and unavailable states stay inside the card, and
**View all notifications** opens
`/notifications?sourceType=DOCUMENT&sourceId=<documentId>`.
`tests/notifications.spec.js` covers the source query and tenant-only header,
newest-three ordering and count, record links, the empty and failure states,
non-blocking loading, refresh, and the filtered queue hand-off.

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

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

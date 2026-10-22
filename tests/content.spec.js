import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const TENANT = '11111111-1111-7111-8111-111111111111';
const DOCUMENT_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';
const NEW_DOCUMENT_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a99';
const MAX_CONTENT_BYTES = 10 * 1024 * 1024;

const DOCUMENT = {
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
  updatedAt: '2026-10-19T12:00:00Z'
};

const FILE_METADATA = {
  documentId: DOCUMENT_ID,
  fileName: 'policy-schedule.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1843200,
  sha256: '9f2c0f4d3a8e7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c',
  uploadedAt: '2026-10-20T15:04:00Z'
};

const FILE_VERSIONS = [
  {
    documentId: DOCUMENT_ID,
    version: 3,
    fileName: 'policy-schedule.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1843200,
    sha256: FILE_METADATA.sha256,
    uploadedAt: '2026-10-20T15:04:00Z'
  },
  {
    documentId: DOCUMENT_ID,
    version: 2,
    fileName: 'policy-schedule-v2.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1843200,
    sha256: 'c'.repeat(64),
    uploadedAt: '2026-10-19T14:02:00Z'
  },
  {
    documentId: DOCUMENT_ID,
    version: 1,
    fileName: 'policy-schedule-v1.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1843000,
    sha256: 'd'.repeat(64),
    uploadedAt: '2026-10-18T13:01:00Z'
  }
];

/**
 * Stateful mock for the Document metadata and content routes. Content is kept
 * per document so a file can be uploaded during registration and then read
 * back from the File tab. Raw byte bodies are captured for assertions. Version
 * history follows the Document API: a plain newest-first array of revision
 * metadata, with each revision downloaded from its own route.
 */
async function installContentMock(page, options = {}) {
  const {
    contents = {},
    contentBytes = {},
    versions = {},
    versionBytes = {},
    metadataStatus = 0,
    metadataError = null,
    uploadStatus = 201,
    uploadError = null,
    contentStatus = 200,
    uploadDelay = 0,
    versionsStatus = 0,
    versionsError = null,
    versionDownloadStatus = 0,
    versionDownloadError = null
  } = options;

  const state = {
    documents: [{ ...DOCUMENT }],
    contents: new Map(Object.entries(contents)),
    bytes: new Map(Object.entries(contentBytes)),
    versions: new Map(Object.entries(versions)),
    versionBytes: new Map(Object.entries(versionBytes)),
    requests: [],
    metadataStatus,
    metadataError,
    uploadStatus,
    uploadError,
    contentStatus,
    uploadDelay,
    versionsStatus,
    versionsError,
    versionDownloadStatus,
    versionDownloadError
  };

  await page.route('**/api/v1/documents**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const recorded = { method, path, headers: request.headers() };
    if (method === 'PUT') {
      recorded.body = request.postDataBuffer() || Buffer.alloc(0);
    } else if (method === 'POST') {
      try {
        recorded.body = request.postDataJSON();
      } catch {
        recorded.body = request.postData();
      }
    }
    state.requests.push(recorded);

    const fulfillJson = (status, payload) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
    const notFound = (message = 'Document not found.') =>
      fulfillJson(404, { code: 'DOCUMENT_NOT_FOUND', message });

    if (path === '/api/v1/documents' && method === 'GET') {
      return fulfillJson(200, state.documents);
    }

    if (path === '/api/v1/documents' && method === 'POST') {
      const body = request.postDataJSON();
      const created = {
        id: NEW_DOCUMENT_ID,
        tenantId: TENANT,
        documentNumber: 'DOC-2026-0000002',
        title: body.title,
        documentType: body.documentType,
        classification: body.classification,
        status: 'RECEIVED',
        retentionUntil: body.retentionUntil,
        version: 0,
        createdAt: '2026-10-20T16:00:00Z',
        updatedAt: '2026-10-20T16:00:00Z'
      };
      state.documents = [created, ...state.documents];
      return fulfillJson(201, created);
    }

    const metadataMatch = path.match(/^\/api\/v1\/documents\/([^/]+)\/content\/metadata$/);
    if (metadataMatch && method === 'GET') {
      if (state.metadataStatus) {
        return fulfillJson(
          state.metadataStatus,
          state.metadataError || {
            code: 'CONTENT_METADATA_UNAVAILABLE',
            message: 'File metadata is temporarily unavailable.'
          }
        );
      }
      const metadata = state.contents.get(metadataMatch[1]);
      return metadata
        ? fulfillJson(200, metadata)
        : fulfillJson(404, {
            code: 'CONTENT_NOT_FOUND',
            message: `No file is stored for document ${metadataMatch[1]}.`
          });
    }

    const versionListMatch = path.match(/^\/api\/v1\/documents\/([^/]+)\/content\/versions$/);
    if (versionListMatch && method === 'GET') {
      if (state.versionsStatus) {
        return fulfillJson(
          state.versionsStatus,
          state.versionsError || {
            code: 'CONTENT_VERSIONS_UNAVAILABLE',
            message: 'Version history is temporarily unavailable.'
          }
        );
      }
      return fulfillJson(200, state.versions.get(versionListMatch[1]) || []);
    }

    const versionDownloadMatch = path.match(
      /^\/api\/v1\/documents\/([^/]+)\/content\/versions\/([^/]+)$/
    );
    if (versionDownloadMatch && method === 'GET') {
      if (state.versionDownloadStatus >= 400) {
        return fulfillJson(
          state.versionDownloadStatus,
          state.versionDownloadError || {
            code: 'CONTENT_VERSION_READ_FAILED',
            message: 'The stored version could not be read.'
          }
        );
      }
      const versionsForDocument = state.versions.get(versionDownloadMatch[1]) || [];
      const entry = versionsForDocument.find(
        (version) => String(version.version) === versionDownloadMatch[2]
      );
      const bytesByVersion = state.versionBytes.get(versionDownloadMatch[1]) || {};
      const buffer = bytesByVersion[versionDownloadMatch[2]];
      if (!entry && !buffer) {
        return fulfillJson(404, {
          code: 'CONTENT_VERSION_NOT_FOUND',
          message: `Version ${versionDownloadMatch[2]} is not stored for this document.`
        });
      }
      return route.fulfill({
        status: 200,
        contentType: (entry && entry.contentType) || 'application/octet-stream',
        headers: {
          'Content-Disposition': `attachment; filename="${(entry && entry.fileName) || `version-${versionDownloadMatch[2]}.bin`}"`,
          'X-Content-SHA256': (entry && entry.sha256) || '',
          'X-Content-Version': versionDownloadMatch[2]
        },
        body: buffer || Buffer.from('stored version content')
      });
    }

    const contentMatch = path.match(/^\/api\/v1\/documents\/([^/]+)\/content$/);
    if (contentMatch && method === 'PUT') {
      if (state.uploadDelay) {
        await new Promise((resolve) => setTimeout(resolve, state.uploadDelay));
      }
      if (state.uploadStatus >= 400) {
        return fulfillJson(
          state.uploadStatus,
          state.uploadError || {
            code: 'CONTENT_UPLOAD_FAILED',
            message: 'The file could not be stored.'
          }
        );
      }
      const headerName = request.headers()['x-file-name'] || 'file';
      let fileName = headerName;
      try {
        fileName = decodeURIComponent(headerName);
      } catch {
        fileName = headerName;
      }
      const existing = state.contents.get(contentMatch[1]);
      const priorVersions = state.versions.get(contentMatch[1]) || [];
      const priorVersion = Math.max(
        Number(existing && existing.currentVersion) || 0,
        ...priorVersions.map((version) => Number(version.version) || 0),
        0
      );
      const version = priorVersion + 1;
      const metadata = {
        documentId: contentMatch[1],
        fileName,
        contentType: request.headers()['content-type'] || 'application/octet-stream',
        sizeBytes: recorded.body.length,
        sha256: 'b'.repeat(64),
        uploadedAt: '2026-10-20T16:00:00Z',
        currentVersion: version
      };
      state.contents.set(contentMatch[1], metadata);
      state.bytes.set(contentMatch[1], recorded.body);
      state.versions.set(contentMatch[1], [
        {
          documentId: contentMatch[1],
          version,
          fileName,
          contentType: metadata.contentType,
          sizeBytes: metadata.sizeBytes,
          sha256: metadata.sha256,
          uploadedAt: metadata.uploadedAt
        },
        ...priorVersions
      ]);
      const versionBytesById = state.versionBytes.get(contentMatch[1]) || {};
      versionBytesById[String(version)] = recorded.body;
      state.versionBytes.set(contentMatch[1], versionBytesById);
      return fulfillJson(201, metadata);
    }

    if (contentMatch && method === 'GET') {
      if (state.contentStatus >= 400) {
        return fulfillJson(state.contentStatus, {
          code: 'CONTENT_READ_FAILED',
          message: 'The stored file could not be read.'
        });
      }
      const metadata = state.contents.get(contentMatch[1]);
      const buffer = state.bytes.get(contentMatch[1]);
      if (!metadata && !buffer) {
        return fulfillJson(404, {
          code: 'CONTENT_NOT_FOUND',
          message: 'No file is stored for this document.'
        });
      }
      return route.fulfill({
        status: 200,
        contentType: (metadata && metadata.contentType) || 'application/octet-stream',
        headers: {
          'Content-Disposition': `attachment; filename="${(metadata && metadata.fileName) || 'stored-file.bin'}"`
        },
        body: buffer || Buffer.from('stored evidence content')
      });
    }

    if (/^\/api\/v1\/documents\/[^/]+\/links$/.test(path) && method === 'GET') {
      return fulfillJson(200, []);
    }

    const detailMatch = path.match(/^\/api\/v1\/documents\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const document = state.documents.find((entry) => entry.id === detailMatch[1]);
      return document
        ? fulfillJson(200, document)
        : notFound(`Document not found: ${detailMatch[1]}`);
    }

    return notFound(`Document not found: ${path}`);
  });

  return state;
}

async function openFileTab(page) {
  await expect(page.getByRole('heading', { name: DOCUMENT.documentNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'File' }).click();
  await expect(page.getByRole('tab', { name: 'File' })).toHaveAttribute('aria-selected', 'true');
}

test('uploads raw bytes with content headers and renders the stored file metadata', async ({ page }) => {
  const state = await installContentMock(page);
  const bytes = Buffer.from('demand letter evidence\nsecond line\n');

  await page.goto('/');
  await openFileTab(page);

  await expect(page.getByTestId('no-content')).toContainText('No file stored');
  await expect(page.getByTestId('file-metadata')).toHaveCount(0);
  await expect(page.getByTestId('download-content')).toHaveCount(0);

  await page.getByLabel('File to upload').setInputFiles({
    name: 'demand-letter.txt',
    mimeType: 'text/plain',
    buffer: bytes
  });
  await expect(page.getByTestId('selected-file')).toContainText('demand-letter.txt');
  await page.getByRole('button', { name: 'Upload file' }).click();

  await expect(page.getByTestId('upload-notice')).toContainText(
    'was uploaded and stored as evidence'
  );
  await expect(page.getByTestId('file-metadata')).toBeVisible();
  await expect(page.getByTestId('content-file-name')).toHaveText('demand-letter.txt');
  await expect(page.getByTestId('content-file-type')).toHaveText('text/plain');
  await expect(page.getByTestId('content-file-size')).toHaveText(`${bytes.length} B`);
  await expect(page.getByTestId('content-file-sha256')).toHaveText('b'.repeat(64));
  await expect(page.getByTestId('content-file-uploaded')).toContainText('Oct 20, 2026');

  const upload = state.requests.find(
    (request) =>
      request.method === 'PUT' && request.path === `/api/v1/documents/${DOCUMENT_ID}/content`
  );
  expect(upload).toBeTruthy();
  expect(upload.headers['x-eia-tenant']).toBe(TENANT);
  expect(upload.headers['content-type']).toBe('text/plain');
  expect(upload.headers['x-file-name']).toBe('demand-letter.txt');
  expect(upload.body.equals(bytes)).toBe(true);
});

test('renders stored metadata and downloads the blob under the metadata file name', async ({ page }) => {
  const bytes = Buffer.from('%PDF-1.7 stored policy schedule\n');
  const state = await installContentMock(page, {
    contents: { [DOCUMENT_ID]: FILE_METADATA },
    contentBytes: { [DOCUMENT_ID]: bytes }
  });

  await page.goto('/');
  await openFileTab(page);

  const metadata = page.getByTestId('file-metadata');
  await expect(metadata).toBeVisible();
  await expect(page.getByTestId('content-file-name')).toHaveText('policy-schedule.pdf');
  await expect(page.getByTestId('content-file-type')).toHaveText('application/pdf');
  await expect(page.getByTestId('content-file-size')).toHaveText('1.8 MiB');
  await expect(page.getByTestId('content-file-sha256')).toHaveText(FILE_METADATA.sha256);
  await expect(page.getByTestId('content-file-uploaded')).toContainText('Oct 20, 2026');
  await expect(page.getByTestId('no-content')).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('policy-schedule.pdf');
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  expect((await readFile(downloadPath)).equals(bytes)).toBe(true);
  await expect(page.getByTestId('download-notice')).toContainText('policy-schedule.pdf downloaded.');

  const read = state.requests.find(
    (request) =>
      request.method === 'GET' && request.path === `/api/v1/documents/${DOCUMENT_ID}/content`
  );
  expect(read).toBeTruthy();
  expect(read.headers['x-eia-tenant']).toBe(TENANT);
});

test('shows the no-file empty state with an upload control and no download', async ({ page }) => {
  await installContentMock(page);

  await page.goto('/');
  await openFileTab(page);

  await expect(page.getByTestId('no-content')).toContainText('No file stored');
  await expect(page.getByTestId('no-content')).toContainText('document metadata stays authoritative');
  await expect(page.getByLabel('File to upload')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeDisabled();
  await expect(page.getByTestId('download-content')).toHaveCount(0);
  await expect(page.getByTestId('file-metadata')).toHaveCount(0);
});

test('rejects an oversized file before issuing an upload request', async ({ page }) => {
  const state = await installContentMock(page);

  await page.goto('/');
  await openFileTab(page);

  await page.getByLabel('File to upload').setInputFiles({
    name: 'oversized.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(MAX_CONTENT_BYTES + 1, 1)
  });

  await expect(page.getByTestId('file-validation-error')).toContainText('10 MiB');
  await expect(page.getByTestId('file-validation-error')).toContainText('oversized.pdf');
  await expect(page.getByTestId('selected-file')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeDisabled();
  expect(state.requests.filter((request) => request.method === 'PUT')).toHaveLength(0);
});

test('shows the upload busy state and contains a failed upload', async ({ page }) => {
  const state = await installContentMock(page, {
    uploadStatus: 500,
    uploadError: {
      code: 'CONTENT_STORE_FAILED',
      message: 'Object storage is unavailable.'
    },
    uploadDelay: 250
  });

  await page.goto('/');
  await openFileTab(page);

  await page.getByLabel('File to upload').setInputFiles({
    name: 'evidence.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('evidence that cannot be stored')
  });
  await page.getByRole('button', { name: 'Upload file' }).click();

  await expect(page.getByTestId('upload-progress')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Uploading…' })).toBeDisabled();

  await expect(page.getByTestId('upload-error')).toContainText('CONTENT_STORE_FAILED');
  await expect(page.getByTestId('upload-error')).toContainText('Object storage is unavailable.');
  await expect(page.getByTestId('upload-progress')).toHaveCount(0);
  await expect(page.getByTestId('no-content')).toBeVisible();
  await expect(page.getByTestId('selected-file')).toContainText('evidence.txt');
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled();
  expect(state.requests.filter((request) => request.method === 'PUT')).toHaveLength(1);
});

test('contains metadata read errors and retries', async ({ page }) => {
  const state = await installContentMock(page, {
    metadataStatus: 503,
    metadataError: {
      code: 'CONTENT_METADATA_UNAVAILABLE',
      message: 'File metadata is temporarily unavailable.'
    }
  });

  await page.goto('/');
  await openFileTab(page);

  const failure = page.getByTestId('content-metadata-error');
  await expect(failure).toContainText('CONTENT_METADATA_UNAVAILABLE');
  await expect(failure).toContainText('File metadata is temporarily unavailable.');
  await expect(page.getByTestId('no-content')).toHaveCount(0);

  state.metadataStatus = 0;
  state.contents.set(DOCUMENT_ID, FILE_METADATA);
  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(page.getByTestId('file-metadata')).toBeVisible();
  await expect(page.getByTestId('content-file-name')).toHaveText('policy-schedule.pdf');
  expect(
    state.requests.filter(
      (request) =>
        request.method === 'GET' &&
        request.path === `/api/v1/documents/${DOCUMENT_ID}/content/metadata`
    )
  ).toHaveLength(2);
});

test('registers a document and uploads the optional file as evidence', async ({ page }) => {
  const state = await installContentMock(page);
  const bytes = Buffer.from('the demand letter itself');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: DOCUMENT.documentNumber })).toBeVisible();

  await page.getByRole('button', { name: 'Register document' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register document' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Title').fill('Demand letter with evidence');
  await dialog.getByLabel('Document type').selectOption('DEMAND_LETTER');
  await dialog.getByLabel('Classification').selectOption('RESTRICTED');
  await dialog.getByLabel('Retention until').fill('2040-01-31');
  await dialog.getByLabel('File (optional)').setInputFiles({
    name: 'demand-letter.txt',
    mimeType: 'text/plain',
    buffer: bytes
  });
  await expect(dialog.getByTestId('register-selected-file')).toContainText('demand-letter.txt');
  await dialog.getByRole('button', { name: 'Register document' }).click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByText('Document registered and “demand-letter.txt” uploaded as evidence.')
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000002' })).toBeVisible();

  const upload = state.requests.find((request) => request.method === 'PUT');
  expect(upload).toBeTruthy();
  expect(upload.path).toBe(`/api/v1/documents/${NEW_DOCUMENT_ID}/content`);
  expect(upload.headers['x-eia-tenant']).toBe(TENANT);
  expect(upload.headers['content-type']).toBe('text/plain');
  expect(upload.headers['x-file-name']).toBe('demand-letter.txt');
  expect(upload.body.equals(bytes)).toBe(true);

  await page.getByRole('tab', { name: 'File' }).click();
  await expect(page.getByTestId('content-file-name')).toHaveText('demand-letter.txt');
  await expect(page.getByTestId('content-file-size')).toHaveText(`${bytes.length} B`);
});

test('keeps the registered document when the optional file upload fails', async ({ page }) => {
  const state = await installContentMock(page, {
    uploadStatus: 500,
    uploadError: {
      code: 'CONTENT_STORE_FAILED',
      message: 'Object storage is unavailable.'
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Register document' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Register document' });
  await dialog.getByLabel('Title').fill('Registered without content');
  await dialog.getByLabel('File (optional)').setInputFiles({
    name: 'unavailable.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('this upload will fail')
  });
  await dialog.getByRole('button', { name: 'Register document' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Document registered.')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('was registered, but');
  await expect(page.getByRole('alert')).toContainText('CONTENT_STORE_FAILED');
  await expect(page.getByRole('alert')).toContainText('Object storage is unavailable.');
  await expect(page.getByRole('heading', { name: 'DOC-2026-0000002' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'File' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('no-content')).toBeVisible();

  // The metadata write stands on its own; only the content write failed.
  expect(state.documents).toHaveLength(2);
  expect(state.contents.has(NEW_DOCUMENT_ID)).toBe(false);
});

test('rejects an oversized file in the register modal before creating the document', async ({ page }) => {
  const state = await installContentMock(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: DOCUMENT.documentNumber })).toBeVisible();

  await page.getByRole('button', { name: 'Register document' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register document' });
  await dialog.getByLabel('Title').fill('Oversized evidence');
  await dialog.getByLabel('File (optional)').setInputFiles({
    name: 'too-large.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(MAX_CONTENT_BYTES + 1, 1)
  });

  await expect(dialog.getByTestId('register-file-error')).toContainText('10 MiB');
  await dialog.getByRole('button', { name: 'Register document' }).click();
  await expect(dialog).toBeVisible();
  expect(state.requests.filter((request) => request.method === 'POST')).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Clear file' }).click();
  await expect(dialog.getByTestId('register-selected-file')).toHaveCount(0);
  await expect(dialog.getByTestId('register-file-error')).toHaveCount(0);
});

test('shows the current version and the retained file versions', async ({ page }) => {
  const current = Buffer.from('%PDF-1.7 current policy schedule\n');
  const state = await installContentMock(page, {
    contents: { [DOCUMENT_ID]: { ...FILE_METADATA, currentVersion: 3 } },
    contentBytes: { [DOCUMENT_ID]: current },
    versions: { [DOCUMENT_ID]: FILE_VERSIONS },
    versionBytes: { [DOCUMENT_ID]: { 3: current } }
  });

  await page.goto('/');
  await openFileTab(page);

  await expect(page.getByTestId('content-current-version')).toHaveText('v3');
  await expect(page.getByTestId('version-count')).toHaveText('3 versions');
  await expect(page.getByTestId('version-history-table')).toBeVisible();
  await expect(page.getByTestId('version-row')).toHaveCount(3);
  await expect(
    page.getByTestId('version-history-table').getByRole('columnheader')
  ).toHaveText([
    'Version',
    'File name',
    'Type',
    'Size',
    'SHA-256',
    'Uploaded',
    'Download'
  ]);
  await expect(page.getByTestId('version-number')).toHaveText(['v3', 'v2', 'v1']);

  const currentRow = page.getByTestId('version-row').first();
  await expect(currentRow.getByTestId('version-number')).toHaveText('v3');
  await expect(currentRow.getByTestId('version-current-badge')).toBeVisible();
  await expect(currentRow.getByTestId('version-file-name')).toHaveText('policy-schedule.pdf');
  await expect(currentRow.getByTestId('version-file-type')).toHaveText('application/pdf');
  await expect(currentRow.getByTestId('version-file-size')).toHaveText('1.8 MiB');
  await expect(currentRow.getByTestId('version-sha256')).toHaveText(
    `${FILE_METADATA.sha256.slice(0, 12)}…`
  );
  await expect(currentRow.getByTestId('version-uploaded')).toContainText('Oct 20, 2026');

  const priorRow = page.getByTestId('version-row').nth(1);
  await expect(priorRow.getByTestId('version-number')).toHaveText('v2');
  await expect(priorRow.getByTestId('version-file-name')).toHaveText('policy-schedule-v2.pdf');
  await expect(priorRow.getByTestId('version-current-badge')).toHaveCount(0);

  const historyRead = state.requests.find(
    (request) =>
      request.method === 'GET' &&
      request.path === `/api/v1/documents/${DOCUMENT_ID}/content/versions`
  );
  expect(historyRead).toBeTruthy();
  expect(historyRead.headers['x-eia-tenant']).toBe(TENANT);
});

test('downloads a retained version as a blob under its stored file name', async ({ page }) => {
  const bytes = Buffer.from('%PDF-1.7 version two\n');
  const state = await installContentMock(page, {
    contents: { [DOCUMENT_ID]: { ...FILE_METADATA, currentVersion: 3 } },
    contentBytes: { [DOCUMENT_ID]: Buffer.from('%PDF-1.7 version three\n') },
    versions: { [DOCUMENT_ID]: FILE_VERSIONS },
    versionBytes: { [DOCUMENT_ID]: { 2: bytes } }
  });

  await page.goto('/');
  await openFileTab(page);

  const row = page.getByTestId('version-row').filter({ hasText: 'policy-schedule-v2.pdf' });
  const downloadPromise = page.waitForEvent('download');
  await row.getByTestId('download-version').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('policy-schedule-v2.pdf');
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  expect((await readFile(downloadPath)).equals(bytes)).toBe(true);
  await expect(page.getByTestId('version-download-notice')).toContainText(
    'Version 2 (policy-schedule-v2.pdf) downloaded.'
  );

  const read = state.requests.find(
    (request) =>
      request.method === 'GET' &&
      request.path === `/api/v1/documents/${DOCUMENT_ID}/content/versions/2`
  );
  expect(read).toBeTruthy();
  expect(read.headers['x-eia-tenant']).toBe(TENANT);
});

test('uploads a new version and refreshes the current version and history', async ({ page }) => {
  const current = Buffer.from('%PDF-1.7 version three\n');
  const replacement = Buffer.from('replacement policy schedule evidence\n');
  const state = await installContentMock(page, {
    contents: { [DOCUMENT_ID]: { ...FILE_METADATA, currentVersion: 3 } },
    contentBytes: { [DOCUMENT_ID]: current },
    versions: { [DOCUMENT_ID]: FILE_VERSIONS },
    versionBytes: { [DOCUMENT_ID]: { 3: current } }
  });

  await page.goto('/');
  await openFileTab(page);
  await expect(page.getByTestId('content-current-version')).toHaveText('v3');

  await page.getByTestId('toggle-upload-version').click();
  await expect(page.getByTestId('version-file-dropzone')).toBeVisible();
  await page.getByLabel('New version file').setInputFiles({
    name: 'policy-schedule-v4.pdf',
    mimeType: 'application/pdf',
    buffer: replacement
  });
  await expect(page.getByTestId('version-selected-file')).toContainText('policy-schedule-v4.pdf');
  await page.getByRole('button', { name: 'Upload new version' }).click();

  await expect(page.getByTestId('upload-notice')).toContainText(
    'was uploaded and stored as evidence'
  );
  await expect(page.getByTestId('content-current-version')).toHaveText('v4');
  await expect(page.getByTestId('version-count')).toHaveText('4 versions');
  await expect(page.getByTestId('version-row')).toHaveCount(4);

  const newest = page.getByTestId('version-row').first();
  await expect(newest.getByTestId('version-number')).toHaveText('v4');
  await expect(newest.getByTestId('version-file-name')).toHaveText('policy-schedule-v4.pdf');
  await expect(newest.getByTestId('version-file-size')).toHaveText(`${replacement.length} B`);
  await expect(newest.getByTestId('version-current-badge')).toBeVisible();

  const upload = state.requests.find(
    (request) =>
      request.method === 'PUT' &&
      request.path === `/api/v1/documents/${DOCUMENT_ID}/content`
  );
  expect(upload).toBeTruthy();
  expect(upload.headers['x-eia-tenant']).toBe(TENANT);
  expect(upload.headers['x-file-name']).toBe('policy-schedule-v4.pdf');
  expect(upload.body.equals(replacement)).toBe(true);
  expect(
    state.requests.filter(
      (request) =>
        request.method === 'GET' &&
        request.path === `/api/v1/documents/${DOCUMENT_ID}/content/versions`
    )
  ).toHaveLength(2);
});

test('shows an empty version history and treats legacy content as version 1', async ({ page }) => {
  await installContentMock(page, {
    contents: { [DOCUMENT_ID]: { ...FILE_METADATA, currentVersion: 1 } },
    contentBytes: { [DOCUMENT_ID]: Buffer.from('%PDF-1.7 legacy content\n') }
  });

  await page.goto('/');
  await openFileTab(page);

  await expect(page.getByTestId('content-current-version')).toHaveText('v1');
  const empty = page.getByTestId('version-history-empty');
  await expect(empty).toContainText('No version history yet');
  await expect(empty).toContainText('The current file is version 1');
  await expect(page.getByTestId('version-history-table')).toHaveCount(0);
  await expect(page.getByTestId('version-row')).toHaveCount(0);
});

test('contains version history read errors and retries', async ({ page }) => {
  const state = await installContentMock(page, {
    contents: { [DOCUMENT_ID]: { ...FILE_METADATA, currentVersion: 3 } },
    contentBytes: { [DOCUMENT_ID]: Buffer.from('%PDF-1.7 version three\n') },
    versions: { [DOCUMENT_ID]: FILE_VERSIONS },
    versionsStatus: 503,
    versionsError: {
      code: 'CONTENT_VERSIONS_UNAVAILABLE',
      message: 'Version history is temporarily unavailable.'
    }
  });

  await page.goto('/');
  await openFileTab(page);

  const failure = page.getByTestId('version-history-error');
  await expect(failure).toContainText('CONTENT_VERSIONS_UNAVAILABLE');
  await expect(failure).toContainText('Version history is temporarily unavailable.');
  await expect(page.getByTestId('version-row')).toHaveCount(0);
  await expect(page.getByTestId('content-current-version')).toHaveText('v3');

  state.versionsStatus = 0;
  await failure.getByRole('button', { name: 'Retry' }).click();

  await expect(page.getByTestId('version-history-table')).toBeVisible();
  await expect(page.getByTestId('version-row')).toHaveCount(3);
  await expect(page.getByTestId('version-count')).toHaveText('3 versions');
  expect(
    state.requests.filter(
      (request) =>
        request.method === 'GET' &&
        request.path === `/api/v1/documents/${DOCUMENT_ID}/content/versions`
    )
  ).toHaveLength(2);
});

test('contains a failed version download', async ({ page }) => {
  await installContentMock(page, {
    contents: { [DOCUMENT_ID]: { ...FILE_METADATA, currentVersion: 3 } },
    contentBytes: { [DOCUMENT_ID]: Buffer.from('%PDF-1.7 version three\n') },
    versions: { [DOCUMENT_ID]: FILE_VERSIONS },
    versionDownloadStatus: 500,
    versionDownloadError: {
      code: 'CONTENT_VERSION_READ_FAILED',
      message: 'The stored version could not be read.'
    }
  });

  await page.goto('/');
  await openFileTab(page);

  const row = page.getByTestId('version-row').filter({ hasText: 'policy-schedule-v2.pdf' });
  const button = row.getByTestId('download-version');
  await button.click();

  const failure = page.getByTestId('version-download-error');
  await expect(failure).toContainText('CONTENT_VERSION_READ_FAILED');
  await expect(failure).toContainText('The stored version could not be read.');
  await expect(button).toBeEnabled();
  await expect(page.getByTestId('version-download-notice')).toHaveCount(0);
});

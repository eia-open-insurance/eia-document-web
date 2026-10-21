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

/**
 * Stateful mock for the Document metadata and content routes. Content is kept
 * per document so a file can be uploaded during registration and then read
 * back from the File tab. Raw byte bodies are captured for assertions.
 */
async function installContentMock(page, options = {}) {
  const {
    contents = {},
    contentBytes = {},
    metadataStatus = 0,
    metadataError = null,
    uploadStatus = 201,
    uploadError = null,
    contentStatus = 200,
    uploadDelay = 0
  } = options;

  const state = {
    documents: [{ ...DOCUMENT }],
    contents: new Map(Object.entries(contents)),
    bytes: new Map(Object.entries(contentBytes)),
    requests: [],
    metadataStatus,
    metadataError,
    uploadStatus,
    uploadError,
    contentStatus,
    uploadDelay
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
      const metadata = {
        documentId: contentMatch[1],
        fileName,
        contentType: request.headers()['content-type'] || 'application/octet-stream',
        sizeBytes: recorded.body.length,
        sha256: 'b'.repeat(64),
        uploadedAt: '2026-10-20T16:00:00Z'
      };
      state.contents.set(contentMatch[1], metadata);
      state.bytes.set(contentMatch[1], recorded.body);
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
  await page.getByRole('button', { name: 'Register document' }).click();
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

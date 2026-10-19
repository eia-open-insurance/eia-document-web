import { test, expect } from '@playwright/test';

test('renders the document workbench and registers a document', async ({ page }) => {
  const documents = [
    {
      id: 'd-1',
      documentNumber: 'DOC-2026-0000001',
      title: 'Policy schedule',
      documentType: 'POLICY',
      classification: 'CONFIDENTIAL',
      status: 'ACTIVE',
      retentionUntil: '2036-10-19',
      version: 3
    }
  ];

  await page.route('**/api/v1/documents**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(documents)
      });
      return;
    }

    if (request.method() === 'POST' && path === '/api/v1/documents') {
      const body = request.postDataJSON();
      const created = {
        id: `d-${documents.length + 1}`,
        documentNumber: `DOC-2026-${String(documents.length + 1).padStart(7, '0')}`,
        title: body.title,
        documentType: body.documentType,
        classification: body.classification,
        status: 'RECEIVED',
        retentionUntil: body.retentionUntil,
        version: 0
      };
      documents.push(created);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created)
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Document' })).toBeVisible();
  await expect(page.getByText('DOC-2026-0000001')).toBeVisible();
  await expect(page.getByText('Policy schedule')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'CONFIDENTIAL' })).toBeVisible();

  await page.getByLabel('Title').fill('New demand letter');
  await page.getByLabel('Document type').selectOption('DEMAND_LETTER');
  await page.getByLabel('Classification').selectOption('RESTRICTED');
  await page.getByLabel('Retention until').fill('2040-01-31');
  await page.getByRole('button', { name: 'Register document' }).click();

  await expect(page.getByText('Document registered.')).toBeVisible();
  await expect(page.getByText('New demand letter')).toBeVisible();
  await expect(page.getByText('DOC-2026-0000002')).toBeVisible();
});

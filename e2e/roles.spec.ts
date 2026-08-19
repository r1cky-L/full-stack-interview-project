import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end walkthrough of both roles, driving the real UI.
 *
 * The security-check script proves the API and the database refuse the wrong
 * caller. This suite proves the screens a reviewer actually clicks through do
 * the right thing on top of that.
 */

const AGENT_EMAIL = process.env.TEST_AGENT_EMAIL!;
const AGENT_PASSWORD = process.env.TEST_AGENT_PASSWORD!;

// Supabase rejects reserved domains such as example.com at sign-up.
const newEmail = () => `e2e-${randomUUID().slice(0, 8)}@supportdesk.dev`;

async function signUp(page: Page) {
  const email = newEmail();
  const password = `Pw-${randomUUID()}`;

  await page.goto('/login');
  await page.getByRole('button', { name: /Need an account/ }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await page.waitForURL('**/tickets');

  return { email, password };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/tickets');
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');
}

async function createTicket(page: Page, title: string, description: string) {
  await page.getByRole('link', { name: 'New ticket' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Create ticket' }).click();
  await page.waitForURL(/\/tickets\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop()!;
}

test('signed-out visitors are sent to the login page', async ({ page }) => {
  await page.goto('/tickets');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Secure Support Desk' })).toBeVisible();
});

test('a customer can sign up, raise a ticket and read it back', async ({ page }) => {
  const { email } = await signUp(page);

  await expect(page.getByRole('heading', { name: 'My tickets' })).toBeVisible();
  await expect(page.getByText('Customer')).toBeVisible();
  await expect(page.getByText('No tickets yet.')).toBeVisible();

  await createTicket(page, 'Printer is offline', 'The office printer stopped responding.');

  await expect(page.getByRole('heading', { name: 'Printer is offline' })).toBeVisible();
  await expect(page.getByText('The office printer stopped responding.')).toBeVisible();
  await expect(page.getByTestId('status-badge')).toHaveText('Open');

  // A customer must not be offered the agent's status control.
  await expect(page.getByLabel('Change status')).toHaveCount(0);

  await page.getByRole('link', { name: 'Back to tickets' }).click();
  await expect(page.getByRole('link', { name: /Printer is offline/ })).toBeVisible();

  // The header shows who is signed in.
  await expect(page.getByText(email)).toBeVisible();
});

test('a customer cannot see or open another customer ticket', async ({ page }) => {
  await signUp(page);
  const secretId = await createTicket(page, 'Payroll export is wrong', 'Contains other staff data.');
  await signOut(page);

  await signUp(page);
  await expect(page.getByText('No tickets yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Payroll export is wrong/ })).toHaveCount(0);

  // Guessing the URL directly must not work either.
  await page.goto(`/tickets/${secretId}`);
  await expect(page.getByText('Ticket not found.')).toBeVisible();
  await expect(page.getByText('Contains other staff data.')).toHaveCount(0);
});

test('a support agent sees every ticket, can filter, and can change status', async ({ page }) => {
  const customer = await signUp(page);
  const ticketTitle = `Laptop will not boot ${randomUUID().slice(0, 6)}`;
  const ticketId = await createTicket(page, ticketTitle, 'Black screen after the update.');
  await signOut(page);

  await signIn(page, AGENT_EMAIL, AGENT_PASSWORD);
  await expect(page.getByRole('heading', { name: 'All tickets' })).toBeVisible();
  await expect(page.getByText('Support agent')).toBeVisible();

  // The agent sees the ticket together with the customer who raised it.
  const row = page.getByRole('link', { name: new RegExp(ticketTitle) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(customer.email);

  await page.goto(`/tickets/${ticketId}`);
  await expect(page.getByRole('heading', { name: ticketTitle })).toBeVisible();

  await page.getByLabel('Change status').selectOption('in_progress');
  await expect(page.getByTestId('status-badge')).toHaveText('In progress');

  // The filter should now exclude this ticket from the open list.
  await page.goto('/tickets');
  await page.getByLabel('Status').selectOption('open');
  await expect(page.getByRole('link', { name: new RegExp(ticketTitle) })).toHaveCount(0);

  await page.getByLabel('Status').selectOption('in_progress');
  await expect(page.getByRole('link', { name: new RegExp(ticketTitle) })).toBeVisible();
});

test('the status change made by the agent is visible to the customer', async ({ page }) => {
  const customer = await signUp(page);
  const ticketTitle = `Cannot reset my password ${randomUUID().slice(0, 6)}`;
  const ticketId = await createTicket(page, ticketTitle, 'The reset email never arrives.');
  await signOut(page);

  await signIn(page, AGENT_EMAIL, AGENT_PASSWORD);
  await page.goto(`/tickets/${ticketId}`);
  await page.getByLabel('Change status').selectOption('resolved');
  await expect(page.getByTestId('status-badge')).toHaveText('Resolved');
  await signOut(page);

  await signIn(page, customer.email, customer.password);
  await page.goto(`/tickets/${ticketId}`);
  await expect(page.getByTestId('status-badge')).toHaveText('Resolved');
  // ...but the customer still cannot change it back.
  await expect(page.getByLabel('Change status')).toHaveCount(0);
});

import { env, SELF, fetchMock } from 'cloudflare:test';
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from 'vitest';
import { applySchema, resetDb, insertMember } from './helpers/db.js';
import { setConfig } from '../src/config.js';
import { renderTemplate } from '../src/email/templates.js';
import { createDevAdapter, devMailbox, resetDevMailbox } from '../src/email/adapters/dev.js';
import { createResendAdapter } from '../src/email/adapters/resend.js';
import { createCloudflareAdapter } from '../src/email/adapters/cloudflare.js';
import { createKitAdapter } from '../src/email/adapters/kit.js';
import { buildMimeMessage } from '../src/email/mime.js';
import { getAdapter } from '../src/email/registry.js';
import { sendEmail } from '../src/email/send.js';

beforeAll(async () => {
  await applySchema();
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  await resetDb();
  resetDevMailbox();
  const { keys } = await env.MAGIC_LINKS.list();
  for (const k of keys) await env.MAGIC_LINKS.delete(k.name);
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe('renderTemplate', () => {
  it('renders magic-link subject, text, and html with variables', () => {
    const r = renderTemplate('magic-link', {
      site_name: 'Acme',
      link: 'https://site.example/auth/callback?token=abc',
    });
    expect(r.subject).toContain('Acme');
    expect(r.text).toContain('https://site.example/auth/callback?token=abc');
    expect(r.html).toContain('https://site.example/auth/callback?token=abc');
    expect(r.html).toContain('<a');
  });

  it('escapes HTML-unsafe values in the html body', () => {
    const r = renderTemplate('magic-link', {
      site_name: '<script>x</script>',
      link: 'https://ok.example/?a=1&b=2',
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('a=1&amp;b=2');
  });

  it('throws on an unknown template id', () => {
    expect(() => renderTemplate('nope', {})).toThrow(/Unknown email template/);
  });
});

describe('dev adapter', () => {
  it('records outbound messages in the in-memory mailbox', async () => {
    const adapter = createDevAdapter();
    await adapter.send({ to: 'a@b.co', subject: 's', text: 't', html: '<p>t</p>' });
    expect(devMailbox).toHaveLength(1);
    expect(devMailbox[0]).toMatchObject({
      to: 'a@b.co',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });
    expect(typeof devMailbox[0].sent_at).toBe('number');
  });

  it('resetDevMailbox clears the mailbox', () => {
    devMailbox.push({ to: 'stale@x' });
    resetDevMailbox();
    expect(devMailbox).toHaveLength(0);
  });
});

describe('resend adapter', () => {
  it('throws when constructed without an api key or from address', () => {
    expect(() => createResendAdapter({ apiKey: null, from: 'a@b' })).toThrow();
    expect(() => createResendAdapter({ apiKey: 'k', from: null })).toThrow();
  });

  it('POSTs to Resend with the expected shape and bearer auth', async () => {
    fetchMock
      .get('https://api.resend.com')
      .intercept({
        path: '/emails',
        method: 'POST',
        headers: { authorization: 'Bearer test-key' },
      })
      .reply(200, { id: 'msg_1' });

    const adapter = createResendAdapter({
      apiKey: 'test-key',
      from: 'no-reply@acme.test',
    });
    const result = await adapter.send({
      to: 'a@b.co',
      subject: 'Hi',
      text: 'Hi there',
      html: '<p>Hi there</p>',
    });
    expect(result.ok).toBe(true);
  });

  it('throws on a non-2xx response from Resend', async () => {
    fetchMock
      .get('https://api.resend.com')
      .intercept({ path: '/emails', method: 'POST' })
      .reply(422, 'bad request');

    const adapter = createResendAdapter({
      apiKey: 'test-key',
      from: 'no-reply@acme.test',
    });
    await expect(
      adapter.send({ to: 'a@b.co', subject: 's', text: 't', html: '<p>t</p>' })
    ).rejects.toThrow(/Resend rejected/);
  });
});

describe('getAdapter registry', () => {
  it('defaults to the dev adapter when email_adapter is unset', async () => {
    const adapter = await getAdapter(env);
    expect(adapter.name).toBe('dev');
  });

  it('returns a resend adapter when configured', async () => {
    await setConfig(env.DB, 'email_adapter', 'resend');
    await setConfig(env.DB, 'resend_api_key', 'test-key');
    await setConfig(env.DB, 'email_from', 'no-reply@acme.test');
    const adapter = await getAdapter(env);
    expect(adapter.name).toBe('resend');
  });

  it('returns a kit adapter when configured', async () => {
    await setConfig(env.DB, 'email_adapter', 'kit');
    await setConfig(env.DB, 'kit_api_key', 'kit-test-key');
    await setConfig(env.DB, 'email_from', 'no-reply@acme.test');
    const adapter = await getAdapter(env);
    expect(adapter.name).toBe('kit');
  });

  it('throws for cloudflare mode when the EMAIL binding is missing', async () => {
    await setConfig(env.DB, 'email_adapter', 'cloudflare');
    await setConfig(env.DB, 'email_from', 'no-reply@acme.test');
    await expect(getAdapter(env)).rejects.toThrow(/EMAIL binding/);
  });

  it('throws for an unsupported adapter name', async () => {
    await setConfig(env.DB, 'email_adapter', 'imaginary');
    await expect(getAdapter(env)).rejects.toThrow(/Unsupported email adapter/);
  });
});

describe('buildMimeMessage', () => {
  it('builds a multipart/alternative message with text and html parts', () => {
    const raw = buildMimeMessage({
      from: 'from@x.co',
      to: 'to@x.co',
      subject: 'Hi',
      text: 'hello',
      html: '<p>hello</p>',
    });
    expect(raw).toContain('From: from@x.co');
    expect(raw).toContain('To: to@x.co');
    expect(raw).toContain('Subject: Hi');
    expect(raw).toContain('Content-Type: multipart/alternative');
    expect(raw).toContain('Content-Type: text/plain');
    expect(raw).toContain('Content-Type: text/html');
    expect(raw).toContain('hello');
    expect(raw).toContain('<p>hello</p>');
    expect(raw).toMatch(/\r\n/);
  });

  it('Q-encodes non-ASCII subjects', () => {
    const raw = buildMimeMessage({
      from: 'a@b',
      to: 'c@d',
      subject: 'héllo',
      text: 't',
      html: '<p>t</p>',
    });
    expect(raw).toContain('=?UTF-8?B?');
    expect(raw).not.toContain('Subject: héllo');
  });
});

describe('cloudflare adapter', () => {
  it('throws without an email binding or from address', () => {
    expect(() =>
      createCloudflareAdapter({ emailBinding: null, from: 'a@b' })
    ).toThrow();
    expect(() =>
      createCloudflareAdapter({
        emailBinding: { send: async () => {} },
        from: null,
      })
    ).toThrow();
  });

  it('calls the binding with {from, to, raw MIME}', async () => {
    const calls = [];
    const binding = { send: async (msg) => calls.push(msg) };
    const adapter = createCloudflareAdapter({
      emailBinding: binding,
      from: 'no-reply@acme.test',
    });
    await adapter.send({
      to: 'to@x.co',
      subject: 'Hi',
      text: 'hello',
      html: '<p>hello</p>',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].from).toBe('no-reply@acme.test');
    expect(calls[0].to).toBe('to@x.co');
    expect(calls[0].raw).toContain('Subject: Hi');
    expect(calls[0].raw).toContain('<p>hello</p>');
  });
});

describe('kit adapter — send', () => {
  it('throws when constructed without an api key', () => {
    expect(() => createKitAdapter({ apiKey: null, from: 'a@b' })).toThrow();
  });

  it('requires a from address at send time', async () => {
    const adapter = createKitAdapter({ apiKey: 'k', from: null });
    await expect(
      adapter.send({ to: 'a@b.co', subject: 's', text: 't', html: '<p>t</p>' })
    ).rejects.toThrow(/from address/);
  });

  it('POSTs to Kit with the api-key header', async () => {
    fetchMock
      .get('https://api.kit.com')
      .intercept({
        path: '/v4/broadcasts',
        method: 'POST',
        headers: { 'X-Kit-Api-Key': 'kit-test' },
      })
      .reply(201, { id: 'b_1' });

    const adapter = createKitAdapter({
      apiKey: 'kit-test',
      from: 'no-reply@acme.test',
    });
    const result = await adapter.send({
      to: 'to@x.co',
      subject: 'Hi',
      text: 'hello',
      html: '<p>hello</p>',
    });
    expect(result.ok).toBe(true);
  });

  it('throws on a non-2xx response', async () => {
    fetchMock
      .get('https://api.kit.com')
      .intercept({ path: '/v4/broadcasts', method: 'POST' })
      .reply(401, 'bad key');

    const adapter = createKitAdapter({
      apiKey: 'kit-test',
      from: 'no-reply@acme.test',
    });
    await expect(
      adapter.send({ to: 'a@b.co', subject: 's', text: 't', html: '<p>t</p>' })
    ).rejects.toThrow(/Kit rejected the send/);
  });
});

describe('kit adapter — syncMembership', () => {
  it('adds a tag on action=added', async () => {
    fetchMock
      .get('https://api.kit.com')
      .intercept({
        path: '/v4/subscribers',
        method: 'POST',
        headers: { 'X-Kit-Api-Key': 'kit-test' },
      })
      .reply(201, { id: 's_1' });

    const adapter = createKitAdapter({ apiKey: 'kit-test' });
    const result = await adapter.syncMembership({
      member: { email: 'a@b.co' },
      plan: { name: 'Premium' },
      action: 'added',
    });
    expect(result.ok).toBe(true);
  });

  it('removes a tag on action=removed', async () => {
    fetchMock
      .get('https://api.kit.com')
      .intercept({
        path: `/v4/subscribers/${encodeURIComponent('a@b.co')}/tags/${encodeURIComponent('cfm:plan:Premium')}`,
        method: 'DELETE',
      })
      .reply(204, '');

    const adapter = createKitAdapter({ apiKey: 'kit-test' });
    const result = await adapter.syncMembership({
      member: { email: 'a@b.co' },
      plan: { name: 'Premium' },
      action: 'removed',
    });
    expect(result.ok).toBe(true);
  });

  it('throws on unknown action', async () => {
    const adapter = createKitAdapter({ apiKey: 'kit-test' });
    await expect(
      adapter.syncMembership({
        member: { email: 'a@b.co' },
        plan: { name: 'Premium' },
        action: 'weird',
      })
    ).rejects.toThrow(/Unsupported membership sync action/);
  });

  it('surfaces upstream errors on sync', async () => {
    fetchMock
      .get('https://api.kit.com')
      .intercept({ path: '/v4/subscribers', method: 'POST' })
      .reply(500, 'boom');

    const adapter = createKitAdapter({ apiKey: 'kit-test' });
    await expect(
      adapter.syncMembership({
        member: { email: 'a@b.co' },
        plan: { name: 'Premium' },
        action: 'added',
      })
    ).rejects.toThrow(/Kit tag add failed/);
  });
});

describe('sendEmail end-to-end', () => {
  it('renders the template and dispatches via the active adapter', async () => {
    await sendEmail(env, {
      to: 'to@x.co',
      template: 'magic-link',
      variables: { site_name: 'Acme', link: 'https://x/y' },
    });
    expect(devMailbox).toHaveLength(1);
    expect(devMailbox[0].to).toBe('to@x.co');
    expect(devMailbox[0].subject).toContain('Acme');
    expect(devMailbox[0].text).toContain('https://x/y');
  });
});

describe('POST /auth/magic-link dispatches through the adapter', () => {
  it('sends a magic-link email containing the callback URL', async () => {
    await insertMember(1, 'a@b.co');
    await setConfig(env.DB, 'site_name', 'Acme');

    const res = await SELF.fetch('https://site.example/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co' }),
    });
    expect(res.status).toBe(200);

    expect(devMailbox).toHaveLength(1);
    const mail = devMailbox[0];
    expect(mail.to).toBe('a@b.co');
    expect(mail.subject).toContain('Acme');

    const { keys } = await env.MAGIC_LINKS.list();
    expect(keys).toHaveLength(1);
    expect(mail.text).toContain(
      `https://site.example/auth/callback?token=${keys[0].name}`
    );
  });

  it('does not send any email when the address is unknown', async () => {
    const res = await SELF.fetch('https://site.example/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ghost@example.com' }),
    });
    expect(res.status).toBe(200);
    expect(devMailbox).toHaveLength(0);
  });

  it('still returns 200 when the adapter throws (error is logged, not exposed)', async () => {
    await insertMember(1, 'a@b.co');
    await setConfig(env.DB, 'email_adapter', 'imaginary');

    const res = await SELF.fetch('https://site.example/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co' }),
    });
    expect(res.status).toBe(200);
  });
});

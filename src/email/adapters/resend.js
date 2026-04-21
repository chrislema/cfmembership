const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function createResendAdapter({ apiKey, from }) {
  if (!apiKey) throw new Error('Resend adapter requires an API key');
  if (!from) throw new Error('Resend adapter requires a from address');

  return {
    name: 'resend',
    async send(message) {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Resend rejected the message (${res.status}): ${body}`);
      }
      return { ok: true };
    },
  };
}

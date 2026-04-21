import { buildMimeMessage } from '../mime.js';

export function createCloudflareAdapter({ emailBinding, from }) {
  if (!emailBinding) {
    throw new Error('Cloudflare Email adapter requires an EMAIL binding');
  }
  if (!from) {
    throw new Error('Cloudflare Email adapter requires a from address');
  }

  return {
    name: 'cloudflare',
    async send(message) {
      const raw = buildMimeMessage({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      await emailBinding.send({ from, to: message.to, raw });
      return { ok: true };
    },
  };
}

const KIT_API = 'https://api.kit.com/v4';

export function createKitAdapter({ apiKey, from }) {
  if (!apiKey) throw new Error('Kit adapter requires an API key');

  return {
    name: 'kit',

    async send(message) {
      if (!from) {
        throw new Error('Kit adapter requires a from address to send');
      }
      const res = await fetch(`${KIT_API}/broadcasts`, {
        method: 'POST',
        headers: {
          'X-Kit-Api-Key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subject: message.subject,
          content: message.html ?? message.text,
          public: false,
          subscribers: [{ email_address: message.to }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Kit rejected the send (${res.status}): ${body}`);
      }
      return { ok: true };
    },

    async syncMembership({ member, plan, action }) {
      const tag = `cfm:plan:${plan.name}`;

      if (action === 'added') {
        const res = await fetch(`${KIT_API}/subscribers`, {
          method: 'POST',
          headers: {
            'X-Kit-Api-Key': apiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email_address: member.email,
            tags: [tag],
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Kit tag add failed (${res.status}): ${body}`);
        }
        return { ok: true };
      }

      if (action === 'removed') {
        const res = await fetch(
          `${KIT_API}/subscribers/${encodeURIComponent(member.email)}/tags/${encodeURIComponent(tag)}`,
          {
            method: 'DELETE',
            headers: { 'X-Kit-Api-Key': apiKey },
          }
        );
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Kit tag remove failed (${res.status}): ${body}`);
        }
        return { ok: true };
      }

      throw new Error(`Unsupported membership sync action: ${action}`);
    },
  };
}

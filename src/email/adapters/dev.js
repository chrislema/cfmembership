export const devMailbox = [];

export function createDevAdapter() {
  return {
    name: 'dev',
    async send(message) {
      devMailbox.push({ ...message, sent_at: Date.now() });
      return { ok: true };
    },
  };
}

export function resetDevMailbox() {
  devMailbox.length = 0;
}

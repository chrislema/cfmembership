import { route } from './router.js';

export default {
  async fetch(request, env, ctx) {
    return route(request, env, ctx);
  },
};

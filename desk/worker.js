import nextWorker from "./.open-next/worker.js";
export * from "./.open-next/worker.js";

const worker = {
  fetch(request, env, ctx) {
    // WebSocket upgrades must bypass Next.js' HTTP response adapter.
    const path = new URL(request.url).pathname;
    if (path === "/ws" || /^\/(?:ws|twiml\/live|twiml\/stream-status)\/[a-f0-9]{64}$/.test(path)) {
      return env.VOICE_AGENT.fetch(request);
    }
    return nextWorker.fetch(request, env, ctx);
  },
};

export default worker;

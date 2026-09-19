import nextWorker from "./.open-next/worker.js";
export * from "./.open-next/worker.js";

const worker = {
  fetch(request, env, ctx) {
    // WebSocket upgrades must bypass Next.js' HTTP response adapter.
    if (new URL(request.url).pathname === "/ws") {
      return env.VOICE_AGENT.fetch(request);
    }
    return nextWorker.fetch(request, env, ctx);
  },
};

export default worker;

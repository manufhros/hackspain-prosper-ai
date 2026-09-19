import { join } from "node:path";
import { root } from "../data";
import { childEnvironment } from "../voice/model";
import { killOwned, streamLines, voiceDir } from "../voice/runtime";

export type AudioLane = "caller" | "agent";

/** Nonblocking, bounded copy of the wire. Speaker trouble cannot stall inference or transport. */
export class MonitorFeed {
  private queue: string[] = [];
  private draining = false;
  private stopped = false;
  constructor(private write: (line: string) => Promise<void>, private fail: () => void) {}
  push(role: AudioLane, audio: Buffer) {
    if (this.stopped) return;
    for (let offset = 0; offset < audio.length; offset += 160) {
      const frame = Buffer.alloc(160, 0xff); audio.copy(frame, 0, offset, offset + 160);
      // Drop old monitor frames, never accumulate a delayed replay of the call.
      if (this.queue.length === 20) this.queue.shift();
      this.queue.push(JSON.stringify({ role, payload: frame.toString("base64") }) + "\n");
    }
    void this.drain();
  }
  private async drain() {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try { while (!this.stopped && this.queue.length) await this.write(this.queue.shift()!); }
    catch { this.stop(); this.fail(); }
    finally { this.draining = false; }
  }
  stop() { this.stopped = true; this.queue = []; }
}

export class LivePlayback {
  private child?: ReturnType<typeof Bun.spawn<"pipe", "pipe", "ignore">>;
  private feed?: MonitorFeed;
  private stopping = false;
  readonly warnings: string[] = [];
  constructor(private update: (message: string) => void) {}
  private unavailable = () => {
    if (this.stopping || this.warnings.length) return;
    const warning = "Live playback unavailable; check your Mac audio output. The call and recordings continue (use --mute to disable playback).";
    this.warnings.push(warning); this.update(warning); this.feed?.stop();
    if (this.child) killOwned(this.child.pid);
  };
  async start() {
    try {
      const child = Bun.spawn([join(voiceDir, "venv/bin/python"), "-W", "ignore::DeprecationWarning", join(root, "local-voice/monitor.py")], {
        cwd: root, env: { ...childEnvironment(process.env), PYTHONUNBUFFERED: "1" }, detached: true,
        stdin: "pipe", stdout: "pipe", stderr: "ignore",
      });
      this.child = child;
      let ready!: () => void;
      const started = new Promise<void>(resolve => { ready = resolve; });
      const reading = streamLines(child.stdout, line => { if (line === "ready") ready(); });
      void reading.catch(this.unavailable);
      void child.exited.then(() => { if (!this.stopping) this.unavailable(); });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([started, child.exited.then(() => { throw new Error("Monitor exited"); }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Monitor startup timed out")), 5000); })]);
      } finally { clearTimeout(timer); }
      if (this.stopping || this.warnings.length) return;
      this.feed = new MonitorFeed(async line => { child.stdin.write(line); await child.stdin.flush(); }, this.unavailable);
      this.update("Live playback on — listening through your Mac's current audio output.");
    } catch { this.unavailable(); }
  }
  push = (role: AudioLane, audio: Buffer) => { this.feed?.push(role, audio); };
  async stop() {
    this.stopping = true; this.feed?.stop();
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    const timer = setTimeout(() => killOwned(child.pid), 1000);
    try { await child.stdin.end(); await child.exited; }
    catch { killOwned(child.pid); }
    finally { clearTimeout(timer); }
  }
}

import { emitKeypressEvents, type Key } from "node:readline";

export function safeText(text: string): string {
  return Bun.stripANSI(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").replace(/\t/g, "  ");
}
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const chars = (text: string) => [...graphemes.segment(text)].map(part => part.segment);
export function fit(text: string, width: number): string {
  let result = "";
  for (const char of chars(safeText(text).replace(/\n/g, " "))) { if (Bun.stringWidth(result + char) > width) break; result += char; }
  return result + " ".repeat(Math.max(0, width - Bun.stringWidth(result)));
}
export function wrap(text: string, width: number): string[] {
  width = Math.max(1, width);
  return safeText(text).split("\n").flatMap(line => {
    const lines: string[] = [];
    let current = "";
    for (const word of line.match(/\S+\s*|\s+/gu) ?? []) {
      if (current && Bun.stringWidth(current + word.trimEnd()) > width) { lines.push(current.trimEnd()); current = ""; }
      for (const char of chars(word)) {
        if (Bun.stringWidth(current + char) > width) { lines.push(current.trimEnd()); current = ""; }
        if (Bun.stringWidth(char) <= width) current += char;
      }
    }
    lines.push(current.trimEnd());
    return lines;
  });
}
const theme = { brand: "1;38;5;121", selected: "30;48;5;121", muted: "38;5;245", status: "38;5;215", heading: "1;4" };
export interface View {
  tab: number; tabs: string[]; items: string[]; selected: number; detail: string;
  scroll: number; status: string; footer: string; mode: string; filter: string;
  focus?: "list" | "detail"; fullscreen?: boolean; follow?: boolean;
}
export function detailViewport(width: number, height: number, fullscreen = false) {
  return { width: Math.max(1, width - (!fullscreen && width >= 90 ? Math.min(38, Math.floor(width * 0.32)) + 3 : 2)), height: Math.max(1, height - 8) };
}
export function render(view: View, width: number, height: number, color = true): string {
  width = Math.max(1, width); height = Math.max(1, height);
  if (width < 40 || height < 12) return fit("Resize terminal to at least 40 x 12. q exits.", width);
  const paint = (value: string, code: string) => color ? `\x1b[${code}m${value}\x1b[0m` : value;
  const sections = view.tabs.map((tab, i) => `${i === view.tab ? "[" : " "}${i + 1} ${tab}${i === view.tab ? "]" : " "}`).join(" ");
  const lines = [
    paint(fit(` EL TURNO  /  ${view.mode}`, width), theme.brand),
    fit(Bun.stringWidth(sections) <= width ? sections : ` [${view.tab + 1} ${view.tabs[view.tab]}]  Tab / 1–${view.tabs.length} sections`, width),
    paint(fit(` ${view.filter ? `Search: ${view.filter}  (Esc clears)` : `${view.tabs[view.tab]}  /  ${view.items.length} items`}`, width), theme.muted),
  ];
  const viewport = detailViewport(width, height, view.fullscreen);
  const detail = wrap(view.detail, viewport.width);
  const max = Math.max(0, detail.length - viewport.height);
  const offset = view.follow ? max : Math.max(0, Math.min(view.scroll, max));
  const position = `${offset + 1}–${Math.min(detail.length, offset + viewport.height)}/${detail.length}`;
  const listHeading = `${view.focus !== "detail" ? "›" : " "} ${view.tabs[view.tab]} ${view.items.length ? view.selected + 1 : 0}/${view.items.length}`;
  const detailHeading = `${view.focus === "detail" ? "›" : " "} Details  ${position}${view.follow ? "  LIVE" : ""}`;
  const start = Math.max(0, Math.min(view.selected - Math.floor(viewport.height / 2), view.items.length - viewport.height));
  const itemLine = (row: number, size: number) => {
    const index = start + row, active = index === view.selected && index < view.items.length;
    const line = fit(`${active ? "›" : " "} ${view.items[index] ?? (row === 0 && !view.items.length ? "No matches. / search; Esc clear" : "")}`, size);
    return active ? paint(line, theme.selected) : line;
  };
  if (width >= 90 && !view.fullscreen) {
    const left = width - viewport.width - 3;
    lines.push(paint(fit(listHeading, left) + " │ " + fit(detailHeading, viewport.width), theme.heading));
    for (let row = 0; row < viewport.height; row++) lines.push(itemLine(row, left) + " │ " + fit(detail[offset + row] ?? "", viewport.width));
  } else {
    const showDetail = view.focus === "detail" || view.fullscreen;
    lines.push(paint(fit(showDetail ? detailHeading : `${listHeading}  → opens details`, width), theme.heading));
    for (let row = 0; row < viewport.height; row++) lines.push(showDetail ? fit(` ${detail[offset + row] ?? ""}`, width) : itemLine(row, width));
  }
  lines.push(paint(fit(` ${view.status}`, width), theme.status));
  const actions = wrap(view.footer, width - 2);
  lines.push(fit(` ${actions[0] ?? ""}`, width), fit(` ${actions[1] ?? ""}`, width));
  lines.push(paint(fit(width < 65 ? " ←→ focus  ↑↓ move  ? help  q quit" : " ←→ focus  ↑↓ move  PgUp/PgDn scroll  / search  ? help  q quit", width), theme.muted));
  return lines.join("\r\n");
}
export interface TerminalPort {
  abort: AbortController;
  start(): void;
  draw(): void;
  ask(title: string, initial?: string, hidden?: boolean, signal?: AbortSignal): Promise<string | null>;
  choose(title: string | (() => string), keys: string[], signal?: AbortSignal, timeoutMs?: number): Promise<string | null>;
  close(): void;
}
export class Terminal implements TerminalPort {
  private reader?: (text: string, key: Key) => void;
  private closed = false;
  private promptCancel?: () => void;
  private promptDraw?: () => string;
  readonly abort = new AbortController();
  constructor(private readonly view: () => View, private readonly onKey: (key: Key, text: string) => void) {}
  private handleKey = (text: string, key: Key) => {
    if (key.ctrl && key.name === "c") { this.close(); return; }
    if (this.reader) this.reader(text, key); else this.onKey(key, text);
  };
  private onResize = () => this.draw();
  private onSignal = () => this.close();
  start() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive TTY required. Use --help for non-interactive commands.");
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.on("keypress", this.handleKey);
    process.stdout.on("resize", this.onResize);
    process.on("SIGTERM", this.onSignal); process.on("SIGHUP", this.onSignal);
    process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?7l");
    this.draw();
  }
  draw() {
    if (this.closed) return;
    // Overwrite a complete frame without clearing the screen between updates.
    process.stdout.write("\x1b[?25l\x1b[H" + render(this.view(), process.stdout.columns || 100, process.stdout.rows || 30, !process.env.NO_COLOR) + "\x1b[J" + (this.promptDraw?.() ?? ""));
  }
  private panel(title: string, value: string, hint: string, cursor?: number): string {
    const width = process.stdout.columns || 100, height = process.stdout.rows || 30;
    const headings = wrap(title, Math.max(1, width - 2)).slice(0, Math.max(1, Math.min(3, height - 3)));
    const first = Math.max(1, height - headings.length - 1);
    const lines = [...headings.map(line => ` ${line}`), ` ${value}`, ` ${hint}`];
    let output = lines.map((line, index) => `\x1b[${first + index};1H\x1b[2K${fit(line, width)}`).join("");
    if (cursor !== undefined) output += `\x1b[${first + headings.length};${Math.min(width, cursor + 2)}H\x1b[?25h`;
    return output;
  }
  async ask(title: string, initial = "", hidden = false, signal?: AbortSignal): Promise<string | null> {
    if (this.closed || signal?.aborted) return null;
    return new Promise(resolve => {
      let value = chars(initial), cursor = value.length, settled = false;
      const finish = (answer: string | null) => {
        if (settled) return; settled = true;
        signal?.removeEventListener("abort", cancel); this.reader = undefined; this.promptCancel = undefined; this.promptDraw = undefined;
        resolve(answer); this.draw();
      };
      const cancel = () => finish(null);
      this.promptCancel = cancel;
      signal?.addEventListener("abort", cancel, { once: true });
      this.promptDraw = () => {
        const shown = hidden ? value.map(() => "*") : value;
        const available = Math.max(1, (process.stdout.columns || 100) - 3);
        let start = 0;
        while (start < cursor && Bun.stringWidth(shown.slice(start, cursor).join("")) >= available) start++;
        return this.panel(title, shown.slice(start).join(""), "Enter accept · Esc cancel · Ctrl-U clear", Bun.stringWidth(shown.slice(start, cursor).join("")));
      };
      this.reader = (text, key) => {
        if (key.name === "escape") finish(null);
        else if (key.name === "return") finish(value.join(""));
        else if (key.name === "left") cursor = Math.max(0, cursor - 1);
        else if (key.name === "right") cursor = Math.min(value.length, cursor + 1);
        else if (key.name === "home" || key.ctrl && key.name === "a") cursor = 0;
        else if (key.name === "end" || key.ctrl && key.name === "e") cursor = value.length;
        else if (key.name === "backspace" && cursor) value.splice(--cursor, 1);
        else if (key.name === "delete") value.splice(cursor, 1);
        else if (key.ctrl && key.name === "u") { value = []; cursor = 0; }
        else if (text && !key.ctrl && !key.meta && !["up", "down", "tab", "pageup", "pagedown"].includes(key.name ?? "")) {
          const inserted = chars(safeText(text).replace(/\n/g, " ")); value.splice(cursor, 0, ...inserted); cursor += inserted.length;
        }
        if (!settled) this.draw();
      };
      this.draw();
    });
  }
  async choose(title: string | (() => string), keys: string[], signal?: AbortSignal, timeoutMs?: number): Promise<string | null> {
    if (this.closed || signal?.aborted) return null;
    return new Promise(resolve => {
      let settled = false;
      const finish = (answer: string | null) => {
        if (settled) return; settled = true;
        clearTimeout(timeout); clearInterval(ticker); signal?.removeEventListener("abort", cancel);
        this.reader = undefined; this.promptCancel = undefined; this.promptDraw = undefined; resolve(answer); this.draw();
      };
      const cancel = () => finish(null);
      const timeout = timeoutMs === undefined ? undefined : setTimeout(() => finish("timeout"), timeoutMs);
      const ticker = typeof title === "function" ? setInterval(() => this.draw(), 250) : undefined;
      this.promptCancel = cancel;
      signal?.addEventListener("abort", cancel, { once: true });
      this.promptDraw = () => this.panel(typeof title === "function" ? title() : title, "", "Press a shortcut directly · Ctrl-C quits");
      this.reader = (text, key) => {
        if (key.name === "escape") finish(null);
        else if (keys.includes(key.name ?? "")) finish(key.name!);
        else if (keys.includes(text)) finish(text);
        else if (["pageup", "pagedown", "home", "end"].includes(key.name ?? "")) this.onKey(key, text);
      };
      this.draw();
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort(); this.promptCancel?.();
    process.stdin.off("keypress", this.handleKey);
    process.stdout.off("resize", this.onResize);
    process.off("SIGTERM", this.onSignal); process.off("SIGHUP", this.onSignal);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l");
  }
}

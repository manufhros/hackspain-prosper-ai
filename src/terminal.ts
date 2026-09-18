import { emitKeypressEvents, type Key } from "node:readline";

export function safeText(text: string): string {
  return Bun.stripANSI(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").replace(/\t/g, "  ");
}
export function fit(text: string, width: number): string {
  let result = "";
  for (const char of safeText(text)) { if (Bun.stringWidth(result + char) > width) break; result += char; }
  return result + " ".repeat(Math.max(0, width - Bun.stringWidth(result)));
}
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const line of safeText(text).split("\n")) {
    let current = "";
    for (const char of line) {
      if (Bun.stringWidth(current + char) > width) { lines.push(current); current = ""; }
      current += char;
    }
    lines.push(current);
  }
  return lines;
}
export interface View {
  tab: number; tabs: string[]; items: string[]; selected: number; detail: string;
  scroll: number; status: string; footer: string; mode: string; filter: string;
}
export function detailViewport(width: number, height: number) {
  const body = Math.max(1, height - 6);
  return width >= 90
    ? { width: width - Math.min(43, Math.floor(width * 0.36)) - 4, height: body }
    : { width: Math.max(1, width - 2), height: body - Math.min(4, Math.floor(body / 3)) };
}
export function render(view: View, width: number, height: number, color = true): string {
  width = Math.max(1, width); height = Math.max(1, height);
  if (width < 40 || height < 12) return fit("Resize terminal to at least 40 x 12. q exits.", width);
  const paint = (value: string, code: string) => color ? `\x1b[${code}m${value}\x1b[0m` : value;
  const sections = view.tabs.map((tab, i) => `${i === view.tab ? "[" : " "}${i + 1} ${tab}${i === view.tab ? "]" : " "}`).join(" ");
  const lines = [
    paint(fit(` EL TURNO  /  test workbench${width > 65 ? "     " + view.mode : ""}`, width), "1;38;5;121;48;5;235"),
    fit(Bun.stringWidth(sections) <= width ? sections : ` [${view.tab + 1} ${view.tabs[view.tab]}]  Tab / 1–${view.tabs.length} sections`, width),
    paint(fit(` ${view.filter ? `Filter: ${view.filter}` : "73 public cases / 18 problems / provider-neutral"}`, width), "38;5;245"),
  ];
  const bodyHeight = height - 6;
  if (width >= 90) {
    const leftWidth = Math.min(43, Math.floor(width * 0.36));
    const detail = wrap(view.detail, width - leftWidth - 4);
    const start = Math.max(0, Math.min(view.selected - Math.floor(bodyHeight / 2), view.items.length - bodyHeight));
    const offset = Math.max(0, Math.min(view.scroll, detail.length - bodyHeight));
    for (let row = 0; row < bodyHeight; row++) {
      const index = start + row, active = index === view.selected;
      const text = fit(`${active ? ">" : " "} ${view.items[index] ?? ""}`, leftWidth);
      lines.push((active ? paint(text, "30;48;5;121") : text) + " │ " + fit(detail[offset + row] ?? "", width - leftWidth - 3));
    }
  } else {
    const listHeight = Math.min(4, Math.floor(bodyHeight / 3));
    for (let row = 0; row < listHeight; row++) {
      const index = view.selected + row;
      const line = fit(`${row === 0 ? ">" : " "} ${view.items[index] ?? ""}`, width);
      lines.push(row === 0 ? paint(line, "30;48;5;121") : line);
    }
    const detail = wrap(view.detail, width - 2), available = bodyHeight - listHeight;
    const offset = Math.max(0, Math.min(view.scroll, detail.length - available));
    for (let row = 0; row < available; row++) lines.push(fit(` ${detail[offset + row] ?? ""}`, width));
  }
  lines.push(paint(fit(` ${view.status}`, width), "38;5;215"));
  lines.push(fit(` ${view.footer}`, width));
  lines.push(paint(fit(" ↑↓ select  PgUp/PgDn scroll  Tab section  / filter  Esc back  q quit", width), "38;5;245"));
  return lines.join("\r\n");
}
export interface TerminalPort {
  abort: AbortController;
  start(): void;
  draw(): void;
  ask(title: string, initial?: string, hidden?: boolean, signal?: AbortSignal): Promise<string | null>;
  close(): void;
}
export class Terminal implements TerminalPort {
  private reader?: (text: string, key: Key) => void;
  private closed = false;
  private promptCancel?: () => void;
  private promptDraw?: () => void;
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
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", this.handleKey);
    process.stdout.on("resize", this.onResize);
    process.on("SIGTERM", this.onSignal);
    process.on("SIGHUP", this.onSignal);
    process.stdout.write("\x1b[?1049h\x1b[?25l");
    this.draw();
  }
  draw() {
    if (this.closed) return;
    process.stdout.write("\x1b[H\x1b[2J" + render(this.view(), process.stdout.columns || 100, process.stdout.rows || 30, !process.env.NO_COLOR));
    this.promptDraw?.();
  }
  async ask(title: string, initial = "", hidden = false, signal?: AbortSignal): Promise<string | null> {
    if (this.closed || signal?.aborted) return null;
    return new Promise(resolve => {
      let value = initial;
      const draw = () => {
        const width = process.stdout.columns || 100;
        const prefix = fit(title, Math.min(Math.floor(width / 2), title.length)).trimEnd() + ": ";
        let shown = hidden ? "*".repeat(value.length) : value;
        const available = Math.max(1, width - Bun.stringWidth(prefix) - 15);
        while (Bun.stringWidth(shown) > available) shown = [...shown].slice(1).join("");
        process.stdout.write(`\x1b[${process.stdout.rows || 30};1H\x1b[2K` + fit(`${prefix}${shown}  [Enter / Esc]`, width));
      };
      const cancel = () => finish(null);
      const finish = (answer: string | null) => { signal?.removeEventListener("abort", cancel); this.reader = undefined; this.promptCancel = undefined; this.promptDraw = undefined; resolve(answer); this.draw(); };
      this.promptCancel = () => finish(null);
      signal?.addEventListener("abort", cancel, { once: true });
      this.promptDraw = draw;
      this.reader = (text, key) => {
        if (key.name === "escape") finish(null);
        else if (key.name === "return") finish(value);
        else if (key.name === "backspace") value = [...value].slice(0, -1).join("");
        else if (key.ctrl && key.name === "u") value = "";
        else if (text && !key.ctrl && !key.meta && !["left", "right", "up", "down", "tab", "delete", "home", "end", "pageup", "pagedown"].includes(key.name ?? "")) value += safeText(text).replace(/\n/g, "");
        if (this.reader) draw();
      };
      draw();
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
    process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
  }
}

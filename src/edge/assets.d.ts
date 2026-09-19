// These imports use Bun's explicit `with { type: "text" }` asset loader.
declare module '*public/style.css' { const text: string; export default text; }
declare module '*public/app.js' { const text: string; export default text; }
declare module '*public/audio.js' { const text: string; export default text; }
declare module '*public/capture.js' { const text: string; export default text; }
declare module '*public/locale.js' { const text: string; export default text; }

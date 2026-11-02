// Hand-kept copy of the palette in theme.css and the .md rules in box/box.css; change them together.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** A standalone page for the rendered report, styled like the app's markdown preview. */
export const exportHtml = (title: string, bodyHtml: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
:root {
  color-scheme: dark;
  --ground: #0b1017; --rail: #10161f; --raised: #151d28; --hover: #1a2330; --border: #1f2935;
  --text: #e6ebf2; --muted: #8792a3;
  --accent: #2bc89a; --accent-fill: #0f2a24; --accent-border: #1e5e4d;
  --easy: #9bd45a; --medium: #f2a93b; --hard: #f0435a; --insane: #a78bfa;
  --danger: #f0435a;
  --sans: 'Barlow', sans-serif; --cond: 'Barlow Condensed', sans-serif; --mono: 'JetBrains Mono', monospace;
}
* { box-sizing: border-box; }
body { background: var(--ground); color: var(--text); font: 15px/1.6 var(--sans); margin: 0; }
main { max-width: 74ch; margin: 40px auto; padding: 0 16px; }
a { text-decoration: none; }
.md { max-width: 74ch; line-height: 1.6; overflow-wrap: anywhere; }
.md > :last-child { margin-bottom: 0; }
.md p, .md ul, .md ol, .md pre, .md table, .md blockquote { margin: 0 0 10px; }
.md h1, .md h2, .md h3, .md h4 { font: 600 20px/1.2 var(--cond); margin: 14px 0 6px; }
.md h1 { font-size: 26px; }
.md h2 { font-size: 22px; }
.md h3 { font-size: 18px; }
.md h4 { font-size: 15px; color: var(--muted); }
.md ul, .md ol { padding-left: 22px; }
.md strong { font-weight: 600; }
.md a { color: var(--accent); border-bottom: 1px dashed var(--accent-border); }
.md code { font: 0.92em var(--mono); background: var(--raised); border-radius: 3px; padding: 0 4px; }
.md pre { background: var(--rail); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; overflow-x: auto; }
.md pre code { font: 13px/1.6 var(--mono); background: none; padding: 0; }
.md blockquote { color: var(--muted); padding-left: 14px; font-style: italic; }
.md table { border-collapse: collapse; }
.md th, .md td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.md .blank { color: var(--muted); }
/* end of the hand-kept copy of box.css */
</style>
</head>
<body>
<main class="md">${bodyHtml}</main>
</body>
</html>
`

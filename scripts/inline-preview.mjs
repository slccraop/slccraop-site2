// Turns the sample build in /preview into ONE index.html that works when double-clicked (no server needed).
// The JavaScript and CSS are inlined; the font files stay in preview/assets next to it.
import { readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';

const dir = 'preview';
let html = readFileSync(`${dir}/index.html`, 'utf8');
const js = html.match(/<script[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/);
const css = html.match(/<link[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/);
if (!js || !css) throw new Error('Could not find the built JS and CSS in preview/index.html');
const jsText = readFileSync(`${dir}/${js[1]}`, 'utf8').replaceAll('</script', '<\\/script');
const cssText = readFileSync(`${dir}/${css[1]}`, 'utf8');
html = html.replace(js[0], '').replace(css[0], `<style>${cssText}</style>`);
html = html.replace('</body>', () => `<script>${jsText}</script>\n</body>`);
writeFileSync(`${dir}/index.html`, html);
rmSync(`${dir}/${js[1]}`);
rmSync(`${dir}/${css[1]}`);
rmSync(`${dir}/_headers`, { force: true });
console.log(
  `preview/index.html ready (${Math.round(html.length / 1024)} KB). Fonts: ${readdirSync(`${dir}/assets`).length} files in preview/assets`,
);

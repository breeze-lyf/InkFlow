#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bundles = [
  path.join(root, 'node_modules/vditor/dist/index.min.js'),
  path.join(root, 'node_modules/vditor/dist/method.min.js'),
];
const unsafeParser = `Function('"use strict";return ('.concat(e,")"))()`;
const strictParser = 'JSON.parse(e)';
const unsafeMermaid = 'securityLevel:"loose",altFontFamily:"sans-serif",fontFamily:"sans-serif",startOnLoad:!1,flowchart:{htmlLabels:!0,useMaxWidth:!0}';
const strictMermaidWithoutLabels = 'securityLevel:"strict",altFontFamily:"sans-serif",fontFamily:"sans-serif",startOnLoad:!1,flowchart:{htmlLabels:!1,useMaxWidth:!0}';
const strictMermaid = 'securityLevel:"strict",altFontFamily:"sans-serif",fontFamily:"sans-serif",startOnLoad:!1,flowchart:{htmlLabels:!0,useMaxWidth:!0}';

for (const bundle of bundles) {
  if (!fs.existsSync(bundle)) throw new Error(`Vditor bundle missing: ${bundle}`);
  const source = fs.readFileSync(bundle, 'utf8');
  let patched = source;
  if (patched.includes(unsafeParser)) {
    patched = patched.replace(unsafeParser, strictParser);
  } else if (!patched.includes(strictParser)) {
    throw new Error(`Vditor parser signature changed; review before patching ${path.basename(bundle)}`);
  }
  if (patched.includes(unsafeMermaid)) {
    patched = patched.replace(unsafeMermaid, strictMermaid);
  } else if (patched.includes(strictMermaidWithoutLabels)) {
    patched = patched.replace(strictMermaidWithoutLabels, strictMermaid);
  } else if (!patched.includes(strictMermaid)) {
    throw new Error(`Vditor Mermaid signature changed; review before patching ${path.basename(bundle)}`);
  }
  if (patched.includes(unsafeParser) || patched.includes(unsafeMermaid) || patched.includes(strictMermaidWithoutLabels)) {
    throw new Error(`Unable to replace the Vditor parser in ${path.basename(bundle)}`);
  }
  if (patched !== source) fs.writeFileSync(bundle, patched, 'utf8');
  console.log(`[vditor] strict JSON and Mermaid safety applied: ${path.basename(bundle)}`);
}

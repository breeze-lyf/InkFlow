const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

function declarationValue(rule, variable) {
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = rule.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`));
  assert.ok(match, `missing declaration for ${variable}`);
  return match[1].trim();
}

for (const theme of ['light', 'dark']) {
  test(`${theme} content theme keeps headings line-free and explicit rules visible`, () => {
    const file = path.join(ROOT, `renderer/css/content/inkflow-${theme}.css`);
    const css = fs.readFileSync(file, 'utf8');

    for (const selector of ['.vditor-reset h1', '.vditor-reset h2']) {
      const heading = ruleBody(css, selector);
      assert.match(heading, /border-bottom:\s*none\s*;/);
      assert.match(heading, /padding-bottom:\s*0\s*;/);
    }

    const divider = ruleBody(css, '.vditor-reset hr');
    assert.match(divider, /height:\s*1px\s*;/);
    assert.match(divider, /background:\s*var\(--ink-border\)\s*;/);
    assert.match(divider, /display:\s*block\s*;/);
    assert.match(divider, /margin:\s*1em\s+0\s*;/);
  });
}

test('yan accent exposes a complete neutral palette in both appearance modes', () => {
  const html = fs.readFileSync(path.join(ROOT, 'renderer/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'renderer/css/themes.css'), 'utf8');

  const expected = {
    light: {
      palette: {
        '--bg-app': '#f9f9f9',
        '--bg-sidebar': '#f3f3f3',
        '--bg-editor': '#ffffff',
        '--bg-elevated': '#ffffff',
        '--text-1': '#1a1c1f',
        '--accent': '#414141',
      },
      content: {
        '--ink-text': '#1a1c1f',
        '--ink-accent': '#414141',
        '--ink-code-bg': '#f3f3f3',
      },
      pre: '#f3f3f3',
      kbd: '#f9f9f9',
      diagram: '#f9f9f9',
    },
    dark: {
      palette: {
        '--bg-app': '#181818',
        '--bg-sidebar': '#181818',
        '--bg-editor': '#212121',
        '--bg-elevated': '#282828',
        '--text-1': '#dfdfdf',
        '--accent': '#afafaf',
      },
      content: {
        '--ink-text': '#dfdfdf',
        '--ink-accent': '#afafaf',
        '--ink-code-bg': '#181818',
      },
      pre: '#181818',
      kbd: '#282828',
      diagram: '#181818',
    },
  };

  assert.equal((html.match(/data-v="yan"/g) || []).length, 1);
  assert.match(html, /<button data-v="yan">砚灰<\/button>/);

  for (const theme of ['light', 'dark']) {
    const palette = ruleBody(css, `body[data-accent="yan"][data-theme="${theme}"]`);
    for (const variable of [
      '--bg-app', '--bg-sidebar', '--bg-editor', '--text-1', '--text-2',
      '--border', '--accent', '--accent-strong', '--accent-soft', '--link',
      '--mark', '--code-inline', '--selection',
    ]) {
      assert.match(palette, new RegExp(`${variable.replace(/-/g, '\\-')}:\\s*[^;]+;`), `missing ${variable} for yan ${theme}`);
    }
    for (const [variable, value] of Object.entries(expected[theme].palette)) {
      assert.equal(declarationValue(palette, variable), value, `unexpected ${variable} for yan ${theme}`);
    }

    const content = ruleBody(css, `body[data-accent="yan"][data-theme="${theme}"] .vditor-reset`);
    for (const variable of [
      '--ink-text', '--ink-text-2', '--ink-text-3', '--ink-accent',
      '--ink-accent-strong', '--ink-border', '--ink-code-bg', '--ink-quote-bg',
      '--ink-mark', '--ink-inline-code',
    ]) {
      assert.match(content, new RegExp(`${variable.replace(/-/g, '\\-')}:\\s*[^;]+;`), `missing ${variable} for yan ${theme} content`);
    }
    for (const [variable, value] of Object.entries(expected[theme].content)) {
      assert.equal(declarationValue(content, variable), value, `unexpected ${variable} for yan ${theme} content`);
    }

    const link = ruleBody(css, `body[data-accent="yan"][data-theme="${theme}"] .vditor-reset a`);
    assert.match(link, /text-decoration:\s*underline\s*;/);

    const preSelector = `body[data-accent="yan"][data-theme="${theme}"] .vditor-reset pre`;
    const kbdSelector = `body[data-accent="yan"][data-theme="${theme}"] .vditor-reset kbd`;
    const tableSelector = `body[data-accent="yan"][data-theme="${theme}"] .vditor-reset table th`;
    const diagramSelector = `body[data-accent="yan"][data-theme="${theme}"] .vditor-reset .language-mindmap`;
    assert.equal(declarationValue(ruleBody(css, preSelector), 'background'), expected[theme].pre);
    assert.equal(declarationValue(ruleBody(css, kbdSelector), 'background'), expected[theme].kbd);
    assert.equal(declarationValue(ruleBody(css, diagramSelector), 'background'), expected[theme].diagram);
    assert.match(ruleBody(css, tableSelector), /background:\s*[^;]+;/, `missing neutral background for ${tableSelector}`);
  }

  assert.doesNotMatch(css, /#(?:f1f1ef|e9e9e6|f8f8f6|fcfcfa|f0f0ee)\b/i);

  for (const selector of [
    'body[data-accent="yan"] #welcome-logo img',
    'body[data-accent="yan"] .vditor-reset img[alt="InkFlow 墨流"]',
  ]) {
    assert.match(ruleBody(css, selector), /filter:\s*grayscale\(1\)[^;]*;/);
  }

  const toc = ruleBody(css, 'body[data-accent="yan"] .ink-editor .vditor-ir .vditor-toc');
  assert.match(toc, /color:\s*var\(--accent\)\s*!important\s*;/);
  const tocLink = ruleBody(css, 'body[data-accent="yan"] .ink-editor .vditor-ir .vditor-toc span[data-target-id]');
  assert.match(tocLink, /text-decoration:\s*underline\s*;/);
  assert.match(tocLink, /text-decoration-color:\s*currentColor\s*;/);
});

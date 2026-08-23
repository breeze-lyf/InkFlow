'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadP() {
  const source = fs.readFileSync(path.join(__dirname, '../../renderer/js/utils.js'), 'utf8');
  const context = vm.createContext({ document: {}, setTimeout, clearTimeout, window: {} });
  vm.runInContext(`${source}\nthis.__P = P;`, context);
  return context.__P;
}

test('renderer path helpers preserve Windows UNC roots through join and resolve', () => {
  const P = loadP();

  assert.equal(P.normalize('\\\\server\\share\\docs'), '//server/share/docs');
  assert.equal(P.isAbsolute('\\\\server\\share\\docs'), true);
  assert.equal(P.join('\\\\server\\share', 'docs', 'a.md'), '//server/share/docs/a.md');
  assert.equal(P.resolve('//server/share/docs', '../images/a.png'), '//server/share/images/a.png');
  assert.equal(P.dirname('//server/share/docs/a.md'), '//server/share/docs');
});

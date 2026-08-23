const assert = require('node:assert/strict');
const test = require('node:test');

const { createSmokeRunner } = require('../../main/smoke');

test('smoke runner exposes one orchestration entrypoint and validates its host dependencies', () => {
  assert.throws(() => createSmokeRunner({}), /smoke runner 缺少依赖/);

  const runner = createSmokeRunner({
    app: { isPackaged: false, exit() {} },
    getMainWindow: () => ({ webContents: {} }),
    projectRoot: '/tmp/inkflow',
    waitForRendererReady: async () => {},
    grantFile: () => ({ ok: true }),
    grantFolder: () => ({ ok: true }),
    convertWord: async () => Buffer.from('PK'),
    env: {},
    logger: { log() {} },
  });

  assert.deepEqual(Object.keys(runner), ['run']);
  assert.equal(typeof runner.run, 'function');
});

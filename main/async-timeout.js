'use strict';

function withTimeout(value, timeoutMs, label = '操作') {
  let timer;
  return Promise.race([
    Promise.resolve(value),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时，请重试`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };

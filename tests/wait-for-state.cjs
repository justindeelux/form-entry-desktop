const { setTimeout: wait } = require('node:timers/promises');

exports.waitForState = async (page, predicate, arg, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  do {
    if (await page.evaluate(predicate, arg)) return;
    await wait(50);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for asynchronous app state');
};

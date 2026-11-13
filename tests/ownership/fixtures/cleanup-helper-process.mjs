if (process.env.SANCTUARY_TEST_IGNORE_TERM === '1') process.on('SIGTERM', () => {});
// Tells a test that reads stdout that the handler above is in place.
process.stdout.write('ready\n');
setInterval(() => {}, 1_000);

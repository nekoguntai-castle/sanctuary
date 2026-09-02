if (process.env.SANCTUARY_TEST_IGNORE_TERM === '1') process.on('SIGTERM', () => {});
setInterval(() => {}, 1_000);

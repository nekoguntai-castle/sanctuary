#!/usr/bin/env node

if (process.argv[2] === 'info') process.stdout.write('x'.repeat(32 * 1024));
else process.stdout.write('{"state":"invented"}\n');

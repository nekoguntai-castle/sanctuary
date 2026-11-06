// A narrow structural recognizer, not crash registration. SIGKILL/host loss can
// prevent finally handlers; only the normal supervised process lifecycle is proved.
const WRAPPER = 'scripts/ci/run-sandboxed-playwright.mjs';
const CLI = 'scripts/ci/lib/browser-container-security.mjs';
const ADAPTER = 'scripts/ci/lib/browser-container-ownership.mjs';
const LIFECYCLE_PROOF_MODULES = new Set([
  'scripts/ownership/lifecycle-bootstrap-proof.mjs',
  'scripts/ownership/lifecycle-browser-container-proof.mjs',
  'scripts/ownership/lifecycle-browser-process-proof.mjs',
]);
const BOOTSTRAP_PROOF_TEST = 'tests/ownership/lifecycle-bootstrap-proof.test.mjs';
const BROWSER_CONTAINER_PROOF_TEST = 'tests/ownership/lifecycle-browser-container-proof.test.mjs';
const PURITY_PROOF_TEST = 'tests/ownership/lifecycle-proof-module-purity.test.mjs';
const PURE_TEST_IMPORTS = new Map([
  [BOOTSTRAP_PROOF_TEST, [
    "import assert from 'node:assert/strict';",
    "import { readFileSync } from 'node:fs';",
    "import path from 'node:path';",
    "import test from 'node:test';",
    "import { provesBootstrapStagingLifecycle } from '../../scripts/ownership/lifecycle-bootstrap-proof.mjs';",
  ]],
  [BROWSER_CONTAINER_PROOF_TEST, [
    "import assert from 'node:assert/strict';",
    "import { readFileSync } from 'node:fs';",
    "import path from 'node:path';",
    "import test from 'node:test';",
    "import { provesBrowserContainerLifecycle } from '../../scripts/ownership/lifecycle-browser-container-proof.mjs';",
  ]],
  [PURITY_PROOF_TEST, [
    "import assert from 'node:assert/strict';",
    "import { readFileSync } from 'node:fs';",
    "import path from 'node:path';",
    "import test from 'node:test';",
    "import { lifecycleProofModulePurity } from '../../scripts/ownership/lifecycle-browser-process-proof.mjs';",
  ]],
]);
const EFFECTFUL_IDENTIFIERS = new Set([
  'child_process', 'eval', 'exec', 'execFile', 'execFileSync', 'execSync', 'fetch', 'fork',
  'fs', 'Function', 'globalThis', 'http', 'https', 'import', 'kill', 'mkdtemp',
  'mkdtempSync', 'mkdir', 'mkdirSync', 'module', 'open', 'process', 'readFile',
  'readFileSync', 'Reflect', 'require', 'rm', 'rmSync', 'rmdir', 'rmdirSync',
  'setInterval', 'setTimeout', 'spawn', 'spawnSync', 'unlink', 'unlinkSync',
  'writeFile', 'writeFileSync', 'constructor', '__proto__', 'Deno', 'Bun',
]);

// Dependency-free lexer for this reviewed JavaScript shape. Literal contents stay
// opaque tokens, so comments and quoted example code cannot satisfy contracts.
function literalEnd(source, start, delimiter) {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === '\\') { index++; continue; }
    if (source[index] === delimiter) return index + 1;
  }
  throw new Error('unterminated literal');
}

function regexEnd(source, start) {
  let characterClass = false;
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === '\\') { index++; continue; }
    if (source[index] === '[') characterClass = true;
    if (source[index] === ']') characterClass = false;
    if (source[index] === '/' && !characterClass) {
      while (/[a-z]/i.test(source[index + 1] ?? '') && index + 1 < source.length) index++;
      return index + 1;
    }
  }
  throw new Error('unterminated regex');
}

function tokens(source) {
  const result = [];
  for (let index = 0; index < source.length;) {
    const tail = source.slice(index);
    const whitespace = /^\s+/.exec(tail);
    if (whitespace) { index += whitespace[0].length; continue; }
    if (tail.startsWith('//')) { const end = source.indexOf('\n', index); index = end < 0 ? source.length : end; continue; }
    if (tail.startsWith('/*')) {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) throw new Error('unterminated comment');
      index = end + 2; continue;
    }
    let end;
    if (['"', "'", '`'].includes(source[index])) end = literalEnd(source, index, source[index]);
    else if (source[index] === '/' && ['(', '=', '!', ',', ':', '[', 'return', '=>', '&&', '||'].includes(result.at(-1))) end = regexEnd(source, index);
    else {
      const match = /^(?:[A-Za-z_$][\w$]*|\d[\d_]*|===|!==|=>|\?\.|\?\?|&&|\|\||\.\.\.|==|!=|<=|>=|\+\+|--|.)/.exec(tail);
      if (!match) throw new Error('unsupported token');
      end = index + match[0].length;
    }
    const token = source.slice(index, end);
    // Interpolated process creation is outside this narrow reviewed shape.
    if (token.startsWith('`') && /\$\{[\s\S]*\b(?:spawn|kill)\s*\(/.test(token)) throw new Error('process call in template interpolation');
    result.push(token); index = end;
  }
  return result;
}

function balancedEnd(sequence, start) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let index = start; index < sequence.length; index++) {
    const token = sequence[index];
    if (pairs[token]) stack.push(pairs[token]);
    else if ([')', ']', '}'].includes(token)) {
      if (stack.pop() !== token) throw new Error('unbalanced source');
      if (!stack.length) return index;
    }
  }
  throw new Error('unclosed source');
}

function find(sequence, expected) {
  return sequence.findIndex((_, index) => expected.every((token, offset) => sequence[index + offset] === token));
}

function contains(node, _file, snippets) {
  return Boolean(node) && snippets.every(snippet => find(node, tokens(snippet)) >= 0);
}

function containsStatementsAtDepth(node, snippets, expectedDepth) {
  if (!node) return false;
  const parametersStart = node.indexOf('(');
  const bodyStart = node.indexOf('{', balancedEnd(node, parametersStart)) + 1;
  return snippets.every(snippet => {
    const expected = tokens(snippet);
    let depth = 0;
    for (let index = bodyStart; index < node.length; index++) {
      const token = node[index];
      if (depth === expectedDepth && expected.every((part, offset) => node[index + offset] === part)) {
        const previous = node[index - 1];
        if (previous === ';' || previous === '{' || previous === '}') return true;
      }
      if (token === '{') depth++;
      else if (token === '}') depth--;
    }
    return false;
  });
}
const requireCalls = contains;

function variable(node, name) {
  if (!node) return undefined;
  const start = find(node, ['const', name, '=']);
  if (start < 0) return undefined;
  let end = start + 3;
  while (end < node.length && node[end] !== ';') {
    if (['(', '[', '{'].includes(node[end])) end = balancedEnd(node, end);
    end++;
  }
  return node.slice(start + 3, end);
}

function callback(node, _file, receiver, event) {
  if (!node) return undefined;
  const prefix = tokens(`${receiver}.once('${event}',`);
  const start = find(node, prefix);
  if (start < 0) return undefined;
  return node.slice(start + prefix.length, balancedEnd(node, start + 3));
}

function exactFunction(node, _file, expected) {
  return Boolean(node) && JSON.stringify(node) === JSON.stringify(tokens(expected));
}

function topLevelFunctions(sequence) {
  const result = new Map();
  for (let index = 0; index < sequence.length; index++) {
    if (sequence[index] === 'function' && sequence[index + 2] === '(') {
      const parameterEnd = balancedEnd(sequence, index + 2);
      if (sequence[parameterEnd + 1] !== '{') throw new Error('unsupported function');
      const end = balancedEnd(sequence, parameterEnd + 1);
      result.set(sequence[index + 1], sequence.slice(index, end + 1)); index = end;
    } else if (['(', '[', '{'].includes(sequence[index])) index = balancedEnd(sequence, index);
    else if ([')', ']', '}'].includes(sequence[index])) throw new Error('unexpected closing delimiter');
  }
  return result;
}

function callCount(sequence, name) {
  return sequence.filter((token, index) => token === name && sequence[index + 1] === '(').length;
}

function isIdentifier(token) {
  return /^[A-Za-z_$][\w$]*$/.test(token);
}

function importsArePure(sequence, relativePath, source) {
  const imports = sequence.filter(token => token === 'import');
  if (LIFECYCLE_PROOF_MODULES.has(relativePath)) return imports.length === 0;
  const specifications = PURE_TEST_IMPORTS.get(relativePath);
  if (!specifications) return false;
  const expected = specifications.map(value => tokens(value));
  const actual = [];
  for (let index = 0; index < sequence.length; index++) {
    if (sequence[index] !== 'import') continue;
    let end = index;
    while (end < sequence.length && sequence[end] !== ';') end++;
    if (end === sequence.length) return false;
    actual.push(sequence.slice(index, end + 1));
    index = end;
  }
  return actual.length === expected.length
    && actual.every(entry => expected.some(value => JSON.stringify(value) === JSON.stringify(entry)))
    && actual.every((entry, index) => actual.findIndex(other => JSON.stringify(other) === JSON.stringify(entry)) === index)
    && hasFixedSourceReads(sequence, relativePath, source);
}

function expectedSourceReadPaths(relativePath) {
  if (relativePath === BOOTSTRAP_PROOF_TEST) return ['scripts/ci/bootstrap-node.sh'];
  if (relativePath === BROWSER_CONTAINER_PROOF_TEST) return [];
  return [
    'scripts/ownership/lifecycle-bootstrap-proof.mjs',
    'scripts/ownership/lifecycle-browser-container-proof.mjs',
    'scripts/ownership/lifecycle-browser-process-proof.mjs',
    BOOTSTRAP_PROOF_TEST,
    BROWSER_CONTAINER_PROOF_TEST,
    PURITY_PROOF_TEST,
  ];
}

function hasBrowserContainerTestReads(sequence) {
  const paths = [
    'scripts/ci/run-sandboxed-playwright.mjs',
    'scripts/ci/lib/browser-container-ownership.mjs',
    'scripts/ownership/ci-cleanup-coordinator.mjs',
    '.github/workflows/test.yml',
  ];
  const readHelper = tokens("const read = relative => readFileSync(path.resolve(relative), 'utf8');");
  return callCount(sequence, 'readFileSync') === 1 && callCount(sequence, 'read') === paths.length
    && find(sequence, readHelper) >= 0
    && paths.every(filePath => find(sequence, tokens(`read('${filePath}')`)) >= 0);
}

function hasFixedSourceReads(sequence, relativePath, source) {
  if (relativePath === BROWSER_CONTAINER_PROOF_TEST) return hasBrowserContainerTestReads(sequence);
  const paths = expectedSourceReadPaths(relativePath);
  if (callCount(sequence, 'readFileSync') !== paths.length) return false;
  return paths.every(filePath => {
    const prefix = tokens(`readFileSync(path.resolve('${filePath}'), 'utf8'`);
    const start = find(sequence, prefix);
    const following = sequence[start + prefix.length];
    return start >= 0 && (following === ')' || (following === ',' && sequence[start + prefix.length + 1] === ')'));
  })
    && (source.match(/readFileSync\(\s*path\.resolve\('/g) ?? []).length === paths.length;
}

function templatesArePure(sequence) {
  const templates = sequence.filter(token => token.startsWith('`'));
  return templates.every(token => {
    const expressions = [...token.matchAll(/\$\{([^}]*)\}/g)].map(match => match[1].trim());
    return expressions.every(expression => (
      /^[A-Za-z_$][\w$]*$/.test(expression) && !EFFECTFUL_IDENTIFIERS.has(expression)
    ) || expression === "missing.join(', ')");
  });
}

function hasEffectfulIdentifier(sequence, relativePath) {
  return sequence.some((token, index) => isIdentifier(token)
    && EFFECTFUL_IDENTIFIERS.has(token)
    && !(token === 'exec' && ['.', '?.'].includes(sequence[index - 1]))
    && !(token === 'open' && sequence[index + 1] !== '(')
    && !(token === 'import' && !LIFECYCLE_PROOF_MODULES.has(relativePath))
    && !(token === 'readFileSync' && PURE_TEST_IMPORTS.has(relativePath)));
}

function hasUnreviewedComputedAccess(sequence) {
  const sensitiveBases = new Set(['globalThis', 'this', 'module', 'exports', 'process', 'Reflect']);
  for (let index = 0; index < sequence.length; index++) {
    if (sequence[index] !== ']') continue;
    // Computed calls can hide constructors and method names in concatenated
    // strings. None are needed by the reviewed source recognizers.
    if (sequence[index + 1] === '(' || (sequence[index + 1] === '?.' && sequence[index + 2] === '(')) return true;
    // Also reject computed lookups rooted at ambient authorities, even when
    // the resulting value is invoked through a later dot member.
    if (sequence[index - 1] === '[') continue;
    let cursor = index - 1;
    while (cursor >= 0 && sequence[cursor] !== '[' && sequence[cursor] !== ';' && sequence[cursor] !== '{') cursor--;
    if (cursor >= 2 && sequence[cursor - 1] === '.' && sensitiveBases.has(sequence[cursor - 2])) return true;
    if (cursor >= 1 && sensitiveBases.has(sequence[cursor - 1])) return true;
  }
  return false;
}

/** Allows only the reviewed pure lifecycle recognizers and their fixed source-reading test. */
export function lifecycleProofModulePurity({ relativePath, source }) {
  if (typeof source !== 'string'
      || (!LIFECYCLE_PROOF_MODULES.has(relativePath) && !PURE_TEST_IMPORTS.has(relativePath))) {
    return { proven: false, reason: 'not a reviewed lifecycle proof source' };
  }
  let sequence;
  try { sequence = tokens(source); }
  catch { return { proven: false, reason: 'unsupported source syntax' }; }
  if (!importsArePure(sequence, relativePath, source)) return { proven: false, reason: 'unapproved import or source read' };
  if (!templatesArePure(sequence)) return { proven: false, reason: 'template interpolation is not a plain identifier' };
  if (hasUnreviewedComputedAccess(sequence)) return { proven: false, reason: 'computed property access can hide dynamic authority' };
  if (hasEffectfulIdentifier(sequence, relativePath)) {
    return { proven: false, reason: 'filesystem, process, network, or dynamic execution API found' };
  }
  return { proven: true, reason: PURE_TEST_IMPORTS.has(relativePath)
    ? 'pure mutation fixture with fixed source reads' : 'literal-only lifecycle source recognizer' };
}

function directCliProof(fn, file) {
  const stop = variable(fn, 'stop');
  const close = callback(fn, file, 'child', 'close');
  return containsStatementsAtDepth(fn, [
    "if (signal?.aborted) return Promise.reject(browserCommandError(signal.reason));",
  ], 0) && containsStatementsAtDepth(fn, [
    "const child = spawn('docker', ['--host', `unix://${socket}`, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });",
    "const timeout = setTimeout(() => stop(new Error(`docker ${args[0]} timed out after ${timeoutMs}ms`)), timeoutMs);",
    "const abort = () => stop(signal.reason ?? new Error('docker command cancelled'));",
    "signal?.addEventListener('abort', abort, { once: true });",
    "child.once('error', stop);",
    "const collect = (current, value) => { if (failure) return current; if (Buffer.byteLength(current + value, 'utf8') > maxBuffer) { stop(new Error(`docker ${args[0]} output exceeded ${maxBuffer} bytes`)); return current; } return current + value; };",
  ], 1) && exactFunction(stop, file, "error => { if (failure) return; failure = browserCommandError(error); child.kill('SIGTERM'); forceKill = setTimeout(() => { child.kill('SIGKILL'); closeDeadline = setTimeout(() => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); child.stdout.destroy(); child.stderr.destroy(); child.unref(); reject(new Error('docker child termination was not confirmed', { cause: failure })); }, 2_000); }, 2_000); }") && contains(close, file, [
    'clearTimeout(timeout);', 'clearTimeout(forceKill);', 'clearTimeout(closeDeadline);',
    "signal?.removeEventListener('abort', abort);", 'if (failure) reject(failure); else if (code !== 0) reject(new Error(`docker ${args[0]} exited ${code}: ${stderr.slice(-2000)}`)); else resolve({ stdout, stderr });',
  ]);
}

function commandProof(fn, file) {
  const cancel = variable(fn, 'cancel');
  const close = callback(fn, file, 'child', 'close');
  return containsStatementsAtDepth(fn, ['throwIfAborted(signal);'], 0)
    && containsStatementsAtDepth(fn, [
    "const child = spawn(args[0], args.slice(1), { env, stdio: ['inherit', 'pipe', 'pipe'], detached: true });",
    "const timeout = setTimeout(() => cancel(new Error('test command exceeded the 45 minute deadline')), 45 * 60_000);",
    'const abort = () => cancel(abortReason(signal));',
    "signal?.addEventListener('abort', abort, { once: true });",
  ], 1) && exactFunction(cancel, file, "reason => { if (cancelled) return; cancelled = true; cancellationReason = reason; signalProcessGroup(child, 'SIGTERM'); forceKillPromise = new Promise(resolveKill => setTimeout(() => { signalProcessGroup(child, 'SIGKILL'); resolveKill(); }, 1_000)); }") && contains(close, file, [
    'clearTimeout(timeout);', "signal?.removeEventListener('abort', abort);",
    'if (signal?.aborted && !cancelled) cancel(abortReason(signal));',
    "if (cancelled) { void forceKillPromise.then(() => reject(cancellationReason ?? new Error('test command was cancelled'))); } else resolve({ code: code ?? 1, signal: childSignal });",
  ]);
}

function adapterRetirementProof(source) {
  let functions;
  try { functions = topLevelFunctions(tokens(source)); }
  catch { return false; }
  const retirement = functions.get('retireBrowserContainer');
  const finishAttached = functions.get('finishAttachedServer');
  const boundedWait = functions.get('waitBounded');
  return contains(retirement, source, [
    'const verification = await verifyRetirementOwnership(context, api, assertBrowserChild);',
    'if (!verification.alreadyAbsent && verification.ownershipVerified)',
    'return finishAttachedServer(context, command, failure, verification.ownershipVerified);',
  ]) && contains(finishAttached, source, [
    'if (context.attachPromise) {',
    "try { await waitBounded(context.attachPromise, 5_000, 'attached browser server'); }",
    'context.attachPromise.cancel?.();',
    "failure = combineErrors(failure, error, 'attached browser server did not exit after removal');",
    "if (ownershipVerified) { try { await command(context.socket, ['rm', '--force', context.containerId], { timeoutMs: 10_000 }); }",
  ]) && contains(boundedWait, source, [
    'return await Promise.race([promise,',
    "new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${label} did not exit within ${timeoutMs}ms`)), timeoutMs); })",
    'clearTimeout(timeout);',
  ]);
}

function attachmentProof(fn, file, wholeSource, adapterSource) {
  return containsStatementsAtDepth(fn, ['throwIfAborted(signal);', 'let childClosed = false;'], 0)
    && containsStatementsAtDepth(fn, [
    "child = spawn('docker', ['--host', `unix://${socket}`, 'start', '--attach', containerId], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });",
  ], 1) && containsStatementsAtDepth(fn, [
    'if (!child || childClosed) return;', 'signalProcessGroup(child, signalName);',
    "forceKill = setTimeout(() => signalProcessGroup(child, 'SIGKILL'), 1_000);",
  ], 1) && containsStatementsAtDepth(fn, ['promise.cancel = cancel;'], 0)
    && contains(callback(fn, file, 'child', 'close'), file, ['childClosed = true;', 'clearTimeout(forceKill);', 'resolve(code)'])
    && requireCalls(wholeSource, file, [
      "setTimeout(() => fail(new Error('browser server did not become ready within 45 seconds')), 45_000)",
      "signal?.addEventListener('abort', onAbort, { once: true })",
    ]) && requireCalls(wholeSource, file, [
      'retireBrowserContainer(context, { api, command, assertBrowserChild })',
    ]) && adapterRetirementProof(adapterSource);
}

export function browserProcessOwnershipProof({ relativePath, source, adapterSource }) {
  if (typeof source !== 'string') return { proven: false, reason: 'missing process owner source' };
  if (![WRAPPER, CLI].includes(relativePath)) return { proven: false, reason: 'not a reviewed browser process owner' };
  if (relativePath === WRAPPER && typeof adapterSource !== 'string') {
    return { proven: false, reason: 'missing browser lifecycle adapter source' };
  }
  let file; let functions;
  try { file = tokens(source); functions = topLevelFunctions(file); }
  catch { return { proven: false, reason: 'unsupported process owner syntax' }; }
  const owners = relativePath === CLI ? ['runBrowserEngineCli'] : ['dockerAttached', 'runCommand'];
  if (callCount(file, 'spawn') !== owners.length || owners.some(name => !functions.has(name))) return { proven: false, reason: 'unexpected or missing spawn owner' };
  for (const name of owners) {
    if (callCount(functions.get(name), 'spawn') !== 1) return { proven: false, reason: 'spawn is outside its reviewed owner' };
  }
  const allowedKills = relativePath === CLI ? ["child.kill('SIGTERM')", "child.kill('SIGKILL')"] : ['process.kill(-child.pid, signalName)', 'child.kill(signalName)'];
  if (callCount(file, 'kill') !== allowedKills.length || !requireCalls(file, file, allowedKills)) return { proven: false, reason: 'signal target is not the exact owned child/group' };
  const proven = relativePath === CLI ? directCliProof(functions.get('runBrowserEngineCli'), file)
    && contains(functions.get('browserCommandError'), file, ["return reason instanceof Error ? reason : new Error('docker command cancelled', { cause: reason });"])
    : commandProof(functions.get('runCommand'), file) && attachmentProof(functions.get('dockerAttached'), file, file, adapterSource)
      && contains(functions.get('signalProcessGroup'), file, ["try { process.kill(-child.pid, signalName); } catch (error) { if (error.code !== 'ESRCH') child.kill(signalName); }"]);
  return { proven: Boolean(proven), reason: proven ? 'bounded owned child/group with escalation and close confirmation (not crash registration)' : 'missing reviewed timeout, abort, escalation or close ownership structure' };
}

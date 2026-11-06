// Dependency-free structural recognizer, intentionally limited to this reviewed
// JavaScript shape. Quoted strings and comments never contribute code tokens.
function tokenize(source) {
  const result = [];
  for (let index = 0; index < source.length;) {
    const tail = source.slice(index);
    const whitespace = /^\s+/.exec(tail);
    if (whitespace) { index += whitespace[0].length; continue; }
    if (tail.startsWith('//')) {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (tail.startsWith('/*')) {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) throw new Error('unterminated comment');
      index = end + 2;
      continue;
    }
    if (['"', "'", '`'].includes(source[index])) {
      const delimiter = source[index];
      let value = '';
      let end = index + 1;
      for (; end < source.length; end++) {
        if (source[end] === '\\') {
          if (end + 1 >= source.length) throw new Error('unterminated literal');
          value += source[end + 1]; end++; continue;
        }
        if (source[end] === delimiter) break;
        value += source[end];
      }
      if (end >= source.length) throw new Error('unterminated literal');
      result.push(delimiter === '`' ? `template:${value}` : `string:${value}`);
      index = end + 1; continue;
    }
    const identifier = /^[A-Za-z_$][\w$]*/.exec(tail);
    if (identifier) { result.push(identifier[0]); index += identifier[0].length; continue; }
    const punctuator = /^(?:===|!==|=>|\?\.|\?\?|&&|\|\||\.\.\.|==|!=|<=|>=|\+\+|--|.)/.exec(tail);
    result.push(punctuator[0]); index += punctuator[0].length;
  }
  return result;
}

function has(sequence, snippet) {
  const expected = tokenize(snippet);
  return sequence.some((_, start) => expected.every((token, offset) => sequence[start + offset] === token));
}

function directStatementIndex(sequence, statement) {
  const expected = tokenize(statement);
  let depth = 0;
  for (let index = 0; index < sequence.length; index++) {
    const previous = sequence[index - 1];
    const isDirect = depth === 0 && (index === 0 || [';', '{', '}'].includes(previous));
    if (isDirect && expected.every((token, offset) => sequence[index + offset] === token)) return index;
    if (sequence[index] === '{') depth++;
    else if (sequence[index] === '}') depth--;
  }
  return -1;
}

function directStatementsInOrder(sequence, statements) {
  let previousIndex = -1;
  for (const statement of statements) {
    const index = directStatementIndex(sequence, statement);
    if (index <= previousIndex) return false;
    previousIndex = index;
  }
  return true;
}

function directBlock(sequence, statement) {
  const expected = tokenize(statement);
  let depth = 0;
  for (let index = 0; index < sequence.length; index++) {
    const previous = sequence[index - 1];
    if (depth === 0 && (index === 0 || [';', '{', '}'].includes(previous))
        && expected.every((token, offset) => sequence[index + offset] === token)) {
      const open = index + expected.length;
      if (sequence[open] !== '{') return [];
      let blockDepth = 0;
      for (let end = open; end < sequence.length; end++) {
        if (sequence[end] === '{') blockDepth++;
        else if (sequence[end] === '}' && --blockDepth === 0) return sequence.slice(open + 1, end);
      }
      return [];
    }
    if (sequence[index] === '{') depth++;
    else if (sequence[index] === '}') depth--;
  }
  return [];
}

function functionBody(sequence, name) {
  const nameIndex = sequence.findIndex((token, index) => token === name && sequence[index + 1] === '('
    && (sequence[index - 1] === 'function'
      || (sequence[index - 1] === 'async' && sequence[index - 2] === 'function')));
  if (nameIndex < 0) return [];
  let depth = 0;
  let closeParameters = -1;
  for (let index = nameIndex + 1; index < sequence.length; index++) {
    if (sequence[index] === '(') depth++;
    if (sequence[index] === ')' && --depth === 0) { closeParameters = index; break; }
  }
  if (closeParameters < 0) return [];
  const open = sequence.indexOf('{', closeParameters + 1);
  if (open < 0) return [];
  depth = 0;
  for (let index = open; index < sequence.length; index++) {
    if (sequence[index] === '{') depth++;
    if (sequence[index] === '}' && --depth === 0) return sequence.slice(open + 1, index);
  }
  return [];
}

function laneCommand(workflow, lane) {
  const withoutComments = workflow.split('\n').map(line => line.replace(/\s+#.*$/, '')).join('\n');
  if (lane === 'browser-e2e-backend') {
    return /cleanup-ci-callsite\.sh auto-run \\\s*--engine docker \\\s*--lane browser-e2e-backend/.test(withoutComments);
  }
  return /cleanup-ci-callsite\.sh auto-run --engine docker --lane render-regression-e2e/.test(withoutComments);
}

const OWNERSHIP_FIELDS = [
  ['project', 'io.sanctuary.project'], ['deploymentId', 'io.sanctuary.deployment-id'],
  ['ownerId', 'io.sanctuary.owner-id'], ['resourceClass', 'io.sanctuary.resource-class'],
  ['lifecycle', 'io.sanctuary.lifecycle'], ['cleanupPolicy', 'io.sanctuary.cleanup-policy'],
  ['createdAt', 'io.sanctuary.created-at'], ['createdByRelease', 'io.sanctuary.created-by-release'],
  ['createdByCommit', 'io.sanctuary.created-by-commit'], ['operationRunId', 'io.sanctuary.creation-run-id'],
];

function tokenizedSources(input) {
  if ([input?.wrapper, input?.adapter, input?.coordinator, input?.workflow].some(value => typeof value !== 'string')) return null;
  try {
    return { runner: tokenize(input.wrapper), owner: tokenize(input.adapter), cleanup: tokenize(input.coordinator), workflow: input.workflow };
  } catch { return null; }
}

function authorityChecks(runner, owner) {
  const prepare = functionBody(runner, 'prepareSandbox');
  const authority = functionBody(owner, 'loadBrowserContainerOwnership');
  const contextIndex = prepare.indexOf('ownershipLoader');
  const inspectIndex = prepare.indexOf('outerResult');
  return [
    has(runner, 'ownershipLoader = loadBrowserContainerOwnership'),
    has(runner, 'const ownership = ownershipLoader ( env )'),
    has(runner, 'browserContainerOwnershipLabels ( ownership )'),
    contextIndex >= 0 && inspectIndex > contextIndex,
    has(authority, "if ( env . SANCTUARY_CLEANUP_ENGINE !== 'docker' )"),
    has(authority, "engine : 'docker'"),
    has(authority, 'runCleanupCommand'),
    has(authority, 'const engineEndpoint = dockerAuthority ?. engineGlobalArgs ?. [ 1 ]'),
    has(prepare, 'if ( ownership . engineEndpoint !== `unix://${socket}` )'),
  ].every(Boolean);
}

function recoveryChecks(runner, owner) {
  const launcher = functionBody(runner, 'runSandboxedPlaywright');
  const recovery = functionBody(owner, 'recoverBrowserContainerId');
  const createIndex = launcher.indexOf('createOwnedBrowserContainer');
  const startIndex = launcher.indexOf('startBrowserServer');
  return [
    has(runner, 'await createOwnedBrowserContainer ( context'),
    createIndex >= 0 && startIndex > createIndex,
    has(recovery, 'const recoveredId = assertBrowserContainerOwnership ( recovered , context . ownership , { name : context . name } )'),
    has(recovery, "labels ?. [ RUNNER_OWNED_LABEL ] !== 'v1'"),
  ].every(Boolean);
}

function ownershipFieldCheck(owner, labelsFunction, field, label) {
  const declaration = has(owner, `${field} : '${label}'`);
  const mapped = field === 'resourceClass'
    ? has(labelsFunction, "[ OWNERSHIP_LABELS . resourceClass ] : 'compose_container'")
    : has(labelsFunction, `[ OWNERSHIP_LABELS . ${field} ] : ownership . ${field}`);
  return declaration && mapped;
}

function registrationChecks(runner, owner) {
  const labelsFunction = functionBody(owner, 'browserContainerOwnershipLabels');
  const payloadFunction = functionBody(runner, 'createBrowserPayload');
  const createFunction = functionBody(runner, 'createOwnedBrowserContainer');
  const registrationFunction = functionBody(owner, 'registerAndReinspectBrowserContainer');
  const createAssertion = 'assertBrowserChild ( inspected , { profile : context . profilePath , outerId : context . outerId , imageId : context . image . id } ) ; await registerAndReinspectBrowserContainer ( context , api , registerContainer , assertBrowserChild )';
  return [
    OWNERSHIP_FIELDS.every(([field, label]) => ownershipFieldCheck(owner, labelsFunction, field, label)),
    has(payloadFunction, '... browserContainerOwnershipLabels ( ownership )'),
    has(createFunction, createAssertion),
    has(registrationFunction, 'register ( context . ownership , context . containerId )'),
    has(registrationFunction, 'assertOwnedBrowserContainer ( context , reinspection )'),
  ].every(Boolean);
}

function retirementChecks(owner) {
  const retirement = functionBody(owner, 'retireBrowserContainer');
  const verifyOwnership = functionBody(owner, 'verifyRetirementOwnership');
  const retireVerified = functionBody(owner, 'retireVerifiedContainer');
  const confirmAbsent = functionBody(owner, 'confirmBrowserContainerAbsent');
  const verificationGate = 'if (!verification.alreadyAbsent && verification.ownershipVerified)';
  const verifiedRemoval = directBlock(retirement, verificationGate);
  const presenceCheck = directBlock(confirmAbsent, 'try');
  const absenceCatch = directBlock(confirmAbsent, 'catch (error)');
  const stop = functionBody(owner, 'stopBrowserContainer');
  const remove = functionBody(owner, 'removeBrowserContainer');
  const finishAttached = functionBody(owner, 'finishAttachedServer');
  const attachedCleanup = directBlock(finishAttached, 'if (context.attachPromise)');
  const attachFailure = directBlock(attachedCleanup, 'catch (error)');
  const verifiedRetry = directBlock(attachFailure, 'if (ownershipVerified)');
  const retryAttempt = directBlock(verifiedRetry, 'try');
  return [
    directStatementsInOrder(retirement, [
      'const verification = await verifyRetirementOwnership(context, api, assertBrowserChild);',
      'let failure = verification.failure;',
      verificationGate,
      'return finishAttachedServer(context, command, failure, verification.ownershipVerified);',
    ]),
    directStatementIndex(verifiedRemoval, 'failure = await retireVerifiedContainer(context, { api, command }, failure);') >= 0,
    has(verifyOwnership, 'assertOwnedBrowserContainer ( context , inspected )'),
    has(verifyOwnership, "api ( context . socket , 'GET' , `/v1.41/containers/${context.containerId}/json` )"),
    directStatementsInOrder(retireVerified, [
      'let failure = await retrieveBrowserArtifacts(context, command, initialFailure);',
      'failure = await stopBrowserContainer(context, command, failure);',
      'failure = await removeBrowserContainer(context, command, failure);',
      'return confirmBrowserContainerAbsent(context, api, failure);',
    ]),
    has(stop, "command ( context . socket , [ 'stop' , '--time' , '5' , context . containerId ]"),
    has(remove, "command ( context . socket , [ 'rm' , '--force' , context . containerId ]"),
    directStatementsInOrder(presenceCheck, [
      "const inspect = await api(context.socket, 'GET', `/v1.41/containers/${context.containerId}/json`);",
      'assertOwnedBrowserContainer(context, inspect);',
      'return new Error(`browser container remained present after exact-ID removal${detail}`);',
    ]),
    directStatementIndex(absenceCatch, "if (/returned 404/.test(formatBrowserError(error))) return failure;") >= 0,
    directStatementIndex(absenceCatch, "return combineErrors(failure, error, 'browser container absence could not be confirmed');") >= 0,
    directStatementIndex(retryAttempt, "await command(context.socket, ['rm', '--force', context.containerId], { timeoutMs: 10_000 });") >= 0,
  ].every(Boolean);
}

function engineAndWorkflowChecks(cleanup, workflow) {
  return [
    has(cleanup, 'coordinatorSubjectEnvironment ( prepared . environment , request . engine )'),
    has(cleanup, 'SANCTUARY_CLEANUP_ENGINE : engine'),
    laneCommand(workflow, 'browser-e2e-backend'),
    laneCommand(workflow, 'render-regression-e2e'),
  ].every(Boolean);
}

/** Proves create-time labels, exact recovery, registration, and retirement gates across source files. */
export function provesBrowserContainerLifecycle(input) {
  const sources = tokenizedSources(input);
  if (!sources) {
    const invalidInput = [input?.wrapper, input?.adapter, input?.coordinator, input?.workflow]
      .some(value => typeof value !== 'string');
    return { proven: false, reason: invalidInput
      ? 'all four browser lifecycle sources are required' : 'unsupported or unterminated JavaScript source' };
  }
  const checks = [
    authorityChecks(sources.runner, sources.owner),
    recoveryChecks(sources.runner, sources.owner),
    registrationChecks(sources.runner, sources.owner),
    retirementChecks(sources.owner),
    engineAndWorkflowChecks(sources.cleanup, sources.workflow),
  ];
  const descriptions = [
    'coordinator authority and matching Docker endpoint before engine access',
    'registration and run-bound exact-name crash recovery before browser startup',
    'complete canonical ownership tuple and exact-ID registration/reinspection',
    'ownership-verified stop/removal and absence confirmation',
    'coordinator-selected engine and Docker inventory lane wiring',
  ];
  const missing = checks.flatMap((ok, index) => ok ? [] : [descriptions[index]]);
  return missing.length
    ? { proven: false, reason: `missing lifecycle guarantees: ${missing.join(', ')}` }
    : { proven: true, reason: 'coordinated exact-identity browser container lifecycle is source-proven' };
}

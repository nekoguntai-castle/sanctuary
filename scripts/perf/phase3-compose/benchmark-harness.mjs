
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function createBenchmarkHarness(context) {
  const {
    repoRoot,
    benchmarkEnv,
    redactSensitiveText,
  } = context;

  function runBenchmarkHarness() {
    const result = spawnSync('npm', ['run', 'perf:phase3'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: benchmarkEnv,
      maxBuffer: 1024 * 1024 * 60,
    });
  
    const stdout = redactSensitiveText(result.stdout || '');
    const stderr = redactSensitiveText(result.stderr || '');
    const output = [stdout, stderr].filter(Boolean).join('\n');
  
    if (result.status !== 0) {
      throw new Error([
        redactSensitiveText(`npm run perf:phase3 exited with ${result.status}`),
        output.trim(),
      ].filter(Boolean).join('\n'));
    }
  
    return {
      status: result.status,
      output,
      stdout,
      stderr,
    };
  }
  
  function readBenchmarkEvidence(output) {
    const jsonPath = findGeneratedPath(output, /Wrote (.+phase3-benchmark-.+\.json)/g);
    const mdPath = findGeneratedPath(output, /Wrote (.+phase3-benchmark-.+\.md)/g);
  
    if (!jsonPath || !existsSync(jsonPath)) {
      throw new Error(`Could not find generated Phase 3 benchmark JSON evidence in harness output:\n${output}`);
    }
  
    const benchmark = JSON.parse(readFileSync(jsonPath, 'utf8'));
    return {
      jsonPath,
      mdPath: mdPath && existsSync(mdPath) ? mdPath : null,
      benchmark,
    };
  }
  
  function findGeneratedPath(output, pattern) {
    let match;
    let lastPath = null;
  
    while ((match = pattern.exec(output)) !== null) {
      lastPath = match[1].trim();
    }
  
    if (!lastPath) {
      return null;
    }
  
    return path.isAbsolute(lastPath)
      ? lastPath
      : path.join(repoRoot, lastPath);
  }

  return {
    runBenchmarkHarness,
    readBenchmarkEvidence,
  };
}

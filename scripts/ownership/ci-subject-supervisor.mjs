import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { cleanupProcessGroupHasRunnableMember } from './cleanup-supervisor.mjs';

function signalStatus(signal) {
  const number = constants.signals[signal];
  return Number.isInteger(number) ? 128 + number : 1;
}

function quiescenceError(status, message) {
  return Object.assign(new Error(message), {
    exitCode: status === 0 ? 126 : status,
    cleanupSuppression: 'subject_quiescence_failed',
  });
}

class SubjectSupervisor {
  constructor(child, supervision, resolve, reject) {
    Object.assign(this, { child, supervision, resolve, reject });
    this.stoppedStatus = null;
    this.settled = false;
    this.timers = new Set();
    this.handlers = new Map();
  }

  schedule(callback, ms) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.settled) return;
      try { callback(); } catch (error) { this.failSupervision(error); }
    }, ms);
    this.timers.add(timer);
  }

  settle(callback, value) {
    if (this.settled) return;
    this.settled = true;
    for (const timer of this.timers) clearTimeout(timer);
    for (const [signal, handler] of this.handlers) process.removeListener(signal, handler);
    callback(value);
  }

  failSupervision(error, exitStatus = 126) {
    const failure = quiescenceError(this.stoppedStatus ?? exitStatus, error.message);
    failure.cause = error;
    // Unknown quiescence is durable ambiguity, not permission to keep waiting
    // indefinitely for a process we can no longer observe or signal safely.
    this.child.unref();
    this.settle(this.reject, failure);
  }

  signal(signal) {
    try {
      if (process.platform === 'win32') this.child.kill(signal);
      else process.kill(-this.child.pid, signal);
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }

  groupAlive() {
    if (process.platform === 'win32' || !Number.isInteger(this.child.pid)) return false;
    if (process.platform === 'linux') return cleanupProcessGroupHasRunnableMember(this.child.pid);
    try { process.kill(-this.child.pid, 0); return true; }
    catch (error) {
      if (error.code === 'ESRCH') return false;
      if (error.code === 'EPERM') return true;
      throw error;
    }
  }

  observeQuiescence(deadline = null, failure = null) {
    if (this.settled) return;
    if (!this.groupAlive()) {
      if (failure) this.settle(this.reject, failure);
      else this.settle(this.resolve, this.stoppedStatus);
      return;
    }
    if (deadline !== null && performance.now() >= deadline) {
      this.child.unref();
      this.settle(this.reject, quiescenceError(this.stoppedStatus,
        'subject process group did not quiesce after bounded SIGKILL wait'));
      return;
    }
    this.schedule(() => this.observeQuiescence(deadline, failure), 10);
  }

  stop(status, failure = null) {
    if (this.stoppedStatus !== null || this.settled) return;
    this.stoppedStatus = status;
    this.failure = failure;
    this.signal('SIGTERM');
    this.schedule(() => {
      this.signal('SIGKILL');
      this.observeQuiescence(performance.now() + this.supervision.killWaitMs, failure);
    }, this.supervision.graceMs);
  }

  onExit(code, signal) {
    if (this.stoppedStatus !== null) {
      this.observeQuiescence(null, this.failure);
      return;
    }
    const status = code ?? signalStatus(signal);
    if (this.groupAlive()) {
      this.stop(status === 0 ? 126 : status, quiescenceError(status,
        'subject leader exited while its process group remained runnable'));
    } else this.settle(this.resolve, status);
  }

  start() {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => {
        try { this.stop(signalStatus(signal)); }
        catch (error) { this.failSupervision(error); }
      };
      this.handlers.set(signal, handler);
      process.on(signal, handler);
    }
    this.child.once('error', (error) => {
      if (Number.isInteger(this.child.pid)) this.failSupervision(error);
      else this.settle(this.reject, error);
    });
    this.child.once('exit', (code, signal) => {
      try { this.onExit(code, signal); }
      catch (error) { this.failSupervision(error, code ?? signalStatus(signal)); }
    });
    if (this.supervision.remainingMs != null) {
      this.schedule(() => {
        process.stderr.write('ci-cleanup-coordinator: subject deadline exhausted\n');
        this.stop(124);
      }, this.supervision.remainingMs);
    }
  }
}

export function runSubject(command, args, environment, supervision) {
  if (supervision.remainingMs === 0) return Promise.resolve(124);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...environment }, stdio: 'inherit', detached: process.platform !== 'win32',
    });
    new SubjectSupervisor(child, supervision, resolve, reject).start();
  });
}

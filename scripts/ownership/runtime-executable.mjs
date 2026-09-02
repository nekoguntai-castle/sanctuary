export function liveNodeExecutable() {
  return process.platform === 'linux' ? `/proc/${process.pid}/exe` : process.execPath;
}

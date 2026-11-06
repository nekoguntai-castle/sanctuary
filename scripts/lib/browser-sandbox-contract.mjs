const REQUIRED_LAYERS = ["PID namespaces", "Network namespaces", "Seccomp-BPF sandbox"];

export function validateBrowserSandboxEvidence(evidence = {}) {
  const { diagnosticsText, browserFlags, processInfo, effectiveUid } = evidence ?? {};
  const errors = [];
  if (!Number.isInteger(effectiveUid) || effectiveUid < 0) errors.push("effective UID is missing or invalid");
  else if (effectiveUid === 0) errors.push("browser must not run as root");
  validateFlags(browserFlags, errors);
  validateDiagnostics(diagnosticsText, errors);
  validateRendererProcess(processInfo, errors);
  return { ok: errors.length === 0, errors };
}

function validateFlags(flags, errors) {
  if (!Array.isArray(flags) || flags.length === 0 || flags.some((flag) => typeof flag !== "string")) {
    errors.push("actual browser flags are missing or invalid");
    return;
  }
  if (!flags.includes("--enable-automation")) errors.push("actual browser flags omit --enable-automation");
  const prohibited = new Set([
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-namespace-sandbox",
    "--disable-renderer-sandbox", "--disable-seccomp-filter-sandbox", "--disable-gpu-sandbox",
  ]);
  const disabled = flags.filter((flag) => prohibited.has(flag.split("=", 1)[0]));
  if (disabled.length) errors.push(`sandbox disabling flags present: ${disabled.join(", ")}`);
}

function validateDiagnostics(text, errors) {
  if (typeof text !== "string" || !text.trim()) {
    errors.push("sandbox diagnostics are missing");
    return;
  }
  const start = text.indexOf("Sandbox Status");
  if (start < 0) {
    errors.push("sandbox diagnostics have no Sandbox Status section");
    return;
  }
  const section = text.slice(start);
  const layerOne = section.match(/^\s*Layer 1 Sandbox\s+.*$/gim) ?? [];
  if (layerOne.length !== 1 || !/^\s*Layer 1 Sandbox\s+Namespace\s*$/i.test(layerOne[0] ?? "")) {
    errors.push("Layer 1 sandbox mode must be explicitly Namespace exactly once");
  }
  for (const layer of REQUIRED_LAYERS) validateLayer(section, layer, errors);
}

function validateLayer(section, layer, errors) {
  const escaped = layer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = [...section.matchAll(new RegExp(`^\\s*${escaped}\\s+.*$`, "gmi"))]
    .filter((row) => !(layer === "Seccomp-BPF sandbox" && /^\s*Seccomp-BPF sandbox supports TSYNC\s+/i.test(row[0])));
  const valid = rows.filter((row) => new RegExp(`^\\s*${escaped}\\s+(Yes|No)\\s*$`, "i").test(row[0]));
  if (rows.length !== 1 || valid.length !== 1) errors.push(`sandbox diagnostic is missing, duplicated, or unparseable: ${layer}`);
  else if (/\s+(Yes|No)$/i.exec(valid[0][0])?.[1].toLowerCase() !== "yes") errors.push(`sandbox layer is inactive: ${layer}`);
}

function validateRendererProcess(processInfo, errors) {
  const processes = processInfo?.processInfo;
  if (!Array.isArray(processes)) errors.push("SystemInfo.getProcessInfo response is missing or invalid");
  else if (!processes.some((entry) => typeof entry?.type === "string" && entry.type.toLowerCase() === "renderer" && Number.isSafeInteger(entry.id) && entry.id > 0)) {
    errors.push("browser process list contains no renderer");
  }
}


// Browser endpoints carry bearer-like connection tokens, even on loopback.
export function formatBrowserError(error, { stack = false } = {}) {
  const text = error instanceof Error ? (stack ? error.stack ?? error.message : error.message) : String(error);
  return text.replace(/wss?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/[^\s"'<>)]*/g, '[redacted-browser-endpoint]');
}

export function createBrowserErrorRedactor(write) {
  let pending = '';
  let truncated = false;
  const emit = line => write(`${truncated || line.length > 65_536 ? '[browser diagnostic line truncated]' : formatBrowserError(line)}\n`);
  return {
    write(chunk) {
      pending += String(chunk);
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        emit(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        truncated = false;
      }
      if (pending.length > 65_536) { pending = ''; truncated = true; }
    },
    flush() {
      if (pending || truncated) emit(pending);
      pending = ''; truncated = false;
    },
  };
}

const FORBIDDEN_KEYS = /(?:password|passphrase|secret|token|api[_-]?key|private[_-]?key|database[_-]?url|redis[_-]?url|wallet[_-]?id|user[_-]?id|txid|job[_-]?id)/i;
const FORBIDDEN_VALUES = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:https?|postgres(?:ql)?|redis):\/\/[^\s"/]+:[^\s"@]+@/i,
  /\b(?:xpub|xprv|tpub|tprv|ypub|yprv|zpub|zprv)[1-9A-HJ-NP-Za-km-z]{20,}\b/,
  /\b(?:bc1|tb1|bcrt1)[ac-hj-np-z02-9]{20,}\b/i,
  /\b[13mn2][1-9A-HJ-NP-Za-km-z]{25,34}\b/,
];
const UPLOAD_ONLY_KEYS = /(?:path|host|mount|container[_-]?name|raw[_-]?config|stdout|stderr|command[_-]?output|environment|env)$/i;
const UPLOAD_ONLY_VALUES = /^(?:\/|~\/|[A-Za-z]:\\|\.\.\/|\/tmp\/|\/home\/)/;

function scan(value, path, uploadSafe) {
  if (typeof value === 'string') {
    if (FORBIDDEN_VALUES.some((pattern) => pattern.test(value))) throw new Error(`${path} contains private material`);
    if (uploadSafe && UPLOAD_ONLY_VALUES.test(value)) throw new Error(`${path} contains a local locator`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => scan(child, `${path}[${index}]`, uploadSafe));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(key)) throw new Error(`${path}.${key} is not upload-safe`);
      if (uploadSafe && UPLOAD_ONLY_KEYS.test(key)) throw new Error(`${path}.${key} is not upload-safe`);
      scan(child, `${path}.${key}`, uploadSafe);
    }
  }
}

export function assertUploadSafe(value) {
  scan(value, '$', true);
}

export function assertLocalPrivateSafe(value) {
  scan(value, '$', false);
}

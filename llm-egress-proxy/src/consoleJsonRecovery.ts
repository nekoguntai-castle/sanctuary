const JSON_CHAR_CODE = {
  backslash: 92,
  doubleQuote: 34,
  objectEnd: 125,
  objectStart: 123,
} as const;

interface JsonObjectScannerState {
  depth: number;
  escaped: boolean;
  inString: boolean;
  start: number;
}

function handleJsonStringChar(
  state: JsonObjectScannerState,
  charCode: number,
): boolean {
  if (!state.inString) return false;

  if (state.escaped) {
    state.escaped = false;
    return true;
  }

  if (charCode === JSON_CHAR_CODE.backslash) {
    state.escaped = true;
    return true;
  }

  if (charCode === JSON_CHAR_CODE.doubleQuote) {
    state.inString = false;
  }

  return true;
}

function handleJsonObjectStart(
  state: JsonObjectScannerState,
  index: number,
): void {
  if (state.depth === 0) state.start = index;
  state.depth += 1;
}

function completeJsonObject(
  raw: string,
  state: JsonObjectScannerState,
  index: number,
): string | null {
  if (state.depth === 0) return null;

  state.depth -= 1;
  if (state.depth !== 0 || state.start < 0) return null;

  const objectText = raw.slice(state.start, index + 1);
  state.start = -1;
  return objectText;
}

function scanJsonObjectChar(
  raw: string,
  state: JsonObjectScannerState,
  index: number,
): string | null {
  const charCode = raw.charCodeAt(index);

  if (handleJsonStringChar(state, charCode)) return null;
  if (charCode === JSON_CHAR_CODE.doubleQuote) {
    state.inString = true;
    return null;
  }
  if (charCode === JSON_CHAR_CODE.objectStart) {
    handleJsonObjectStart(state, index);
    return null;
  }
  if (charCode !== JSON_CHAR_CODE.objectEnd) return null;

  return completeJsonObject(raw, state, index);
}

export function extractJsonObjects(raw: string): string[] {
  const objects: string[] = [];
  const state: JsonObjectScannerState = {
    depth: 0,
    escaped: false,
    inString: false,
    start: -1,
  };

  for (let index = 0; index < raw.length; index += 1) {
    const objectText = scanJsonObjectChar(raw, state, index);
    if (objectText) objects.push(objectText);
  }

  return objects;
}

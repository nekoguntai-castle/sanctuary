const EXPECTED = Object.freeze({
  compose_container: Object.freeze({
    authority: Object.freeze([
      'complete-ownership-label-tuple', 'full-engine-id',
      'signed-operator-assertion', 'signed-recovery-scope',
    ]),
    postconditions: Object.freeze([
      'approved-container-id-absent', 'replacement-selector-absent',
    ]),
  }),
  compose_network: Object.freeze({
    authority: Object.freeze([
      'complete-ownership-label-tuple', 'full-engine-id', 'zero-foreign-endpoints',
      'signed-operator-assertion', 'signed-recovery-scope',
    ]),
    postconditions: Object.freeze([
      'approved-network-id-absent', 'replacement-selector-absent',
    ]),
  }),
  compose_volume: Object.freeze({
    authority: Object.freeze([
      'complete-ownership-label-tuple', 'exact-volume-name', 'full-inspect-fingerprint',
      'recovery-attestation-nonce', 'zero-attachments',
      'signed-operator-assertion', 'signed-recovery-scope',
    ]),
    postconditions: Object.freeze([
      'approved-volume-fingerprint-absent', 'replacement-selector-absent',
      'data-volume-refused',
    ]),
  }),
});

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new Error(`${label} fields are invalid`);
  }
}

function exactStrings(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length
      || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error(`${label} must match the exact recovery contract`);
  }
}

/** Validate the only tracked alternative authority contract without widening normal cleanup. */
export function validateOperatorRecoveryContract(value) {
  exactKeys(value, [
    'schemaVersion', 'authorityKind', 'normalCleanupAuthorityUnchanged', 'resourceClasses',
  ], 'operator recovery contract');
  if (value.schemaVersion !== '1.0.0'
      || value.authorityKind !== 'operator_lost_authority_recovery') {
    throw new Error('operator recovery contract identity is invalid');
  }
  if (value.normalCleanupAuthorityUnchanged !== true) {
    throw new Error('normal cleanup authority must remain unchanged');
  }
  const expectedClasses = Object.keys(EXPECTED);
  if (!Array.isArray(value.resourceClasses) || value.resourceClasses.length !== expectedClasses.length) {
    throw new Error('operator recovery contract must contain exactly three resource classes');
  }
  value.resourceClasses.forEach((entry, index) => {
    exactKeys(entry, ['classId', 'authority', 'postconditions'], 'operator recovery resource class');
    const classId = expectedClasses[index];
    if (entry.classId !== classId) throw new Error('operator recovery resource classes are not exact');
    exactStrings(entry.authority, EXPECTED[classId].authority, `${classId} authority`);
    exactStrings(entry.postconditions, EXPECTED[classId].postconditions, `${classId} postconditions`);
  });
  return value;
}

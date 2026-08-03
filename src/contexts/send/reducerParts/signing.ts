import type { TransactionAction, TransactionState } from '../types';
import type { ReducerResult } from './types';

export function reduceSigning(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'SET_SIGNING_DEVICE') {
    return { ...state, signingDeviceId: action.deviceId };
  }

  if (action.type === 'SET_EXPANDED_DEVICE') {
    return { ...state, expandedDeviceId: action.deviceId };
  }

  if (action.type === 'MARK_DEVICE_SIGNED') {
    const newSigned = new Set(state.signedDevices);
    newSigned.add(action.deviceId);
    return { ...state, signedDevices: newSigned };
  }

  if (action.type === 'SET_UNSIGNED_PSBT') {
    return { ...state, unsignedPsbt: action.psbt };
  }

  if (action.type === 'TOGGLE_PSBT_OPTIONS') {
    return { ...state, showPsbtOptions: !state.showPsbtOptions };
  }

  if (action.type === 'SET_SHOW_PSBT_OPTIONS') {
    return { ...state, showPsbtOptions: action.show };
  }

  if (action.type === 'SET_PSBT_DEVICE_ID') {
    return { ...state, psbtDeviceId: action.deviceId };
  }

  if (action.type === 'CLEAR_SIGNATURES') {
    return {
      ...state,
      signedDevices: new Set<string>(),
      unsignedPsbt: null,
      showPsbtOptions: false,
      signingDeviceId: null,
      expandedDeviceId: null,
      psbtDeviceId: null,
    };
  }

  if (action.type === 'SET_SIGNED_DEVICES') {
    return { ...state, signedDevices: new Set(action.deviceIds) };
  }

  return undefined;
}

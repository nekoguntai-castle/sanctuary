export function getSigningDeviceCardClass(hasSigned: boolean): string {
  return `rounded-lg border transition-all ${
    hasSigned
      ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20'
      : 'surface-muted border-sanctuary-200 dark:border-sanctuary-800'
  }`;
}

export function getSigningDeviceIconClass(hasSigned: boolean): string {
  return `w-10 h-10 rounded-lg flex items-center justify-center ${
    hasSigned
      ? 'bg-green-100 dark:bg-green-500/20'
      : 'bg-sanctuary-200 dark:bg-sanctuary-800'
  }`;
}

export function getSigningDeviceLabelClass(hasSigned: boolean): string {
  return `text-sm font-medium ${
    hasSigned
      ? 'text-green-900 dark:text-green-100'
      : 'text-sanctuary-900 dark:text-sanctuary-100'
  }`;
}

export function getUploadControlClass(isUploading: boolean): string {
  return `inline-flex items-center px-3 py-1.5 text-xs font-medium text-sanctuary-700 dark:text-sanctuary-300 bg-white dark:bg-sanctuary-800 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 border border-sanctuary-200 dark:border-sanctuary-600 rounded-lg transition-colors ${
    isUploading ? 'opacity-50 cursor-wait' : ''
  }`;
}

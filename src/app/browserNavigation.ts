interface ReloadableLocation {
  reload: () => void;
}

export function reloadCurrentDocument(location: ReloadableLocation = window.location): void {
  location.reload();
}

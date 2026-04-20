export function accountNoun(count: number): string {
  return count === 1 ? 'Account' : 'Accounts';
}

export function registeredAccountCount(count: number): string {
  return `${count} account${count === 1 ? '' : 's'} registered`;
}

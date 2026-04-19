import { BlockView } from './Block/BlockView';
import { getBlockViewModel } from './Block/blockHelpers';
import type { BlockProps } from './Block/types';

export function Block(props: BlockProps) {
  const viewModel = getBlockViewModel(props);
  return <BlockView {...props} viewModel={viewModel} />;
}

export type { BlockProps };

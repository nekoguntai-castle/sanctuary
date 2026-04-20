import { Brain, MessageSquare, Settings } from 'lucide-react';
import type { TabDefinition } from './types';

export const INTELLIGENCE_TABS: TabDefinition[] = [
  { id: 'insights', label: 'Insights', icon: Brain },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'settings', label: 'Settings', icon: Settings },
];

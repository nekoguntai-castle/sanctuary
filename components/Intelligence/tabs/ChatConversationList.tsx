import type React from 'react';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import type { AIConversation } from '../../../src/api/intelligence';

interface ChatConversationListProps {
  conversations: AIConversation[];
  selectedConversationId: string | null;
  loadingConversations: boolean;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

export const ChatConversationList: React.FC<ChatConversationListProps> = ({
  conversations,
  selectedConversationId,
  loadingConversations,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
}) => (
  <div className="flex w-56 flex-shrink-0 flex-col rounded-xl border border-sanctuary-200 bg-white dark:border-sanctuary-800 dark:bg-sanctuary-900">
    <div className="border-b border-sanctuary-200 p-2 dark:border-sanctuary-800">
      <button
        onClick={onNewConversation}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-primary-700 dark:bg-primary-200 dark:text-primary-900 dark:hover:bg-primary-300"
      >
        <Plus className="h-3.5 w-3.5" />
        New Conversation
      </button>
    </div>

    <div className="flex-1 overflow-y-auto">
      <ConversationListContent
        conversations={conversations}
        selectedConversationId={selectedConversationId}
        loadingConversations={loadingConversations}
        onSelectConversation={onSelectConversation}
        onDeleteConversation={onDeleteConversation}
      />
    </div>
  </div>
);

type ConversationListContentProps = Omit<ChatConversationListProps, 'onNewConversation'>;

function ConversationListContent({
  conversations,
  selectedConversationId,
  loadingConversations,
  onSelectConversation,
  onDeleteConversation,
}: ConversationListContentProps) {
  if (loadingConversations) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-600 border-t-transparent dark:border-primary-200 dark:border-t-transparent" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-sanctuary-400 dark:text-sanctuary-500">
        <MessageSquare className="h-5 w-5" />
        <p className="text-[10px]">No conversations yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col py-1">
      {conversations.map((conversation) => (
        <ConversationListItem
          key={conversation.id}
          conversation={conversation}
          selected={selectedConversationId === conversation.id}
          onSelectConversation={onSelectConversation}
          onDeleteConversation={onDeleteConversation}
        />
      ))}
    </div>
  );
}

interface ConversationListItemProps {
  conversation: AIConversation;
  selected: boolean;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

const ConversationListItem: React.FC<ConversationListItemProps> = ({
  conversation,
  selected,
  onSelectConversation,
  onDeleteConversation,
}) => (
  <div
    className={`group flex items-center gap-1 px-2 py-1.5 ${
      selected
        ? 'bg-primary-50 dark:bg-primary-100/10'
        : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'
    }`}
  >
    <button
      onClick={() => onSelectConversation(conversation.id)}
      className="min-w-0 flex-1 text-left"
    >
      <p
        className={`truncate text-[11px] ${
          selected
            ? 'font-medium text-primary-600 dark:text-primary-300'
            : 'text-sanctuary-700 dark:text-sanctuary-300'
        }`}
      >
        {conversation.title || 'New conversation'}
      </p>
      <p className="text-[9px] text-sanctuary-400 dark:text-sanctuary-500">
        {new Date(conversation.updatedAt).toLocaleDateString()}
      </p>
    </button>
    <button
      onClick={(e) => {
        e.stopPropagation();
        onDeleteConversation(conversation.id);
      }}
      className="flex-shrink-0 rounded p-0.5 text-sanctuary-400 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100 dark:text-sanctuary-500 dark:hover:text-rose-400"
      title="Delete conversation"
    >
      <Trash2 className="h-3 w-3" />
    </button>
  </div>
);

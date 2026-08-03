import React from 'react';
import { ChatConversationList } from './ChatConversationList';
import { ChatMessagePane } from './ChatMessagePane';
import { useChatTabController } from './useChatTabController';

interface ChatTabProps {
  walletId: string;
}

export const ChatTab: React.FC<ChatTabProps> = ({ walletId }) => {
  const controller = useChatTabController({ walletId });

  return (
    <div className="flex h-full gap-3">
      <ChatConversationList
        conversations={controller.conversations}
        selectedConversationId={controller.selectedConversationId}
        loadingConversations={controller.loadingConversations}
        onNewConversation={controller.handleNewConversation}
        onSelectConversation={controller.setSelectedConversationId}
        onDeleteConversation={controller.handleDeleteConversation}
      />

      <ChatMessagePane
        selectedConversationId={controller.selectedConversationId}
        messages={controller.messages}
        loadingMessages={controller.loadingMessages}
        sending={controller.sending}
        input={controller.input}
        messagesEndRef={controller.messagesEndRef}
        inputRef={controller.inputRef}
        onInputChange={controller.setInput}
        onKeyDown={controller.handleKeyDown}
        onSend={controller.handleSend}
      />
    </div>
  );
};

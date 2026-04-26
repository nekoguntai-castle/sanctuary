-- CreateTable
CREATE TABLE "console_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "scope" JSONB,
    "maxSensitivity" TEXT NOT NULL DEFAULT 'wallet',
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "console_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "console_turns" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "promptHistoryId" TEXT,
    "state" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT,
    "scope" JSONB,
    "maxSensitivity" TEXT NOT NULL DEFAULT 'wallet',
    "providerProfileId" TEXT,
    "model" TEXT,
    "plannedTools" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "console_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "console_tool_traces" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB,
    "facts" JSONB,
    "provenance" JSONB,
    "redactions" JSONB,
    "truncation" JSONB,
    "warnings" JSONB,
    "sensitivity" TEXT,
    "rowCount" INTEGER,
    "walletCount" INTEGER,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "console_tool_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "console_prompt_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "turnId" TEXT,
    "prompt" TEXT NOT NULL,
    "normalizedPrompt" TEXT NOT NULL,
    "scope" JSONB,
    "maxSensitivity" TEXT NOT NULL DEFAULT 'wallet',
    "tools" JSONB,
    "providerProfileId" TEXT,
    "model" TEXT,
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "tags" JSONB,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "replayCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "console_prompt_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "console_sessions_userId_updatedAt_idx" ON "console_sessions"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "console_sessions_userId_deletedAt_idx" ON "console_sessions"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "console_sessions_expiresAt_idx" ON "console_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "console_turns_sessionId_createdAt_idx" ON "console_turns"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "console_turns_state_createdAt_idx" ON "console_turns"("state", "createdAt");

-- CreateIndex
CREATE INDEX "console_tool_traces_turnId_createdAt_idx" ON "console_tool_traces"("turnId", "createdAt");

-- CreateIndex
CREATE INDEX "console_tool_traces_toolName_createdAt_idx" ON "console_tool_traces"("toolName", "createdAt");

-- CreateIndex
CREATE INDEX "console_prompt_history_userId_createdAt_idx" ON "console_prompt_history"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "console_prompt_history_userId_saved_idx" ON "console_prompt_history"("userId", "saved");

-- CreateIndex
CREATE INDEX "console_prompt_history_userId_deletedAt_idx" ON "console_prompt_history"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "console_prompt_history_expiresAt_idx" ON "console_prompt_history"("expiresAt");

-- AddForeignKey
ALTER TABLE "console_sessions" ADD CONSTRAINT "console_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "console_turns" ADD CONSTRAINT "console_turns_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "console_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "console_tool_traces" ADD CONSTRAINT "console_tool_traces_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "console_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "console_prompt_history" ADD CONSTRAINT "console_prompt_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "console_prompt_history" ADD CONSTRAINT "console_prompt_history_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "console_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

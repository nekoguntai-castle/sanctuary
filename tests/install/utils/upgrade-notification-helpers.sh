#!/bin/bash
# Notification delivery diagnostics for ref-to-ref upgrade tests.

enqueue_notification_delivery_probe() {
    log_info "Queueing post-upgrade notification delivery probe..."

    local output
    output=$(compose_exec backend env \
        "UPGRADE_NOTIFICATION_WALLET_ID=$TEST_WALLET_ID" \
        "UPGRADE_NOTIFICATION_TXID=$NOTIFICATION_TEST_TXID" \
        node -e '
const { Queue } = require("bullmq");
const Redis = require("ioredis");

(async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required to queue the notification probe");
  }
  const walletId = process.env.UPGRADE_NOTIFICATION_WALLET_ID;
  const txid = process.env.UPGRADE_NOTIFICATION_TXID;
  if (!walletId || !txid) {
    throw new Error("UPGRADE_NOTIFICATION_WALLET_ID and UPGRADE_NOTIFICATION_TXID are required");
  }

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("notifications", {
    connection,
    prefix: "sanctuary:worker",
  });

  await queue.add("transaction-notify", {
    walletId,
    txid,
    type: "received",
    amount: "12345",
    feeSats: null,
  }, {
    jobId: `upgrade-notification-${txid}`,
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: false,
  });

  await queue.close();
  await connection.quit();
  process.stdout.write("queued=true\n");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
' 2>&1) || {
        log_error "Failed to queue notification delivery probe"
        log_error "Probe output: ${output:-<empty>}"
        return 1
    }

    if ! echo "$output" | grep -q '^queued=true$'; then
        log_error "Unexpected notification queue output: $output"
        return 1
    fi
}

read_notification_dlq_entries() {
    compose_exec redis sh -c '
set -eu
for key in $(redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --scan --pattern "sanctuary:dlq:*"); do
  redis-cli -a "$REDIS_PASSWORD" --no-auth-warning GET "$key"
  printf "\n"
done
' 2>/dev/null || true
}

wait_for_notification_dlq_entry() {
    log_info "Waiting for notification probe to reach the DLQ..."

    local attempt output
    for attempt in $(seq 1 30); do
        output=$(read_notification_dlq_entries)
        if echo "$output" | grep -q "$NOTIFICATION_TEST_TXID" && \
           echo "$output" | grep -q 'category.*notification' && \
           echo "$output" | grep -q 'operation.*notifications:transaction-notify'; then
            log_success "Notification probe reached the Redis-backed DLQ"
            return 0
        fi

        sleep 2
    done

    log_error "Notification probe did not reach the Redis-backed DLQ"
    log_error "DLQ output: ${output:-<empty>}"
    return 1
}

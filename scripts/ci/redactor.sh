#!/bin/bash
# Shared redactor helpers for CI diagnostic logs.
#
# Source this file to expose redact_stream and redact_file. Both must
# behave bit-identically to the original inline implementations that
# previously lived in tests/install/utils/collect-upgrade-artifacts.sh,
# because existing install/upgrade artifacts and downstream consumers
# encode this exact redaction behavior.
#
# A regression fixture in tests/install/utils/fixtures/redactor pins the
# canonical input/output and is exercised by tests/ci/redactor-fixture.test.sh.

# shellcheck disable=SC2120

redact_stream() {
    awk '
    {
        line = $0
        lower_line = tolower(line)
        while (match(lower_line, /[a-z0-9_]*(secret|password|token|key|salt|cookie|credential|jobid|job_id)[a-z0-9_]*=[^[:space:]|",;<]+/)) {
            token = substr(line, RSTART, RLENGTH)
            key = token
            sub(/=.*/, "", key)
            line = substr(line, 1, RSTART - 1) key "=<redacted>" substr(line, RSTART + RLENGTH)
            lower_line = tolower(line)
        }
        while (match(lower_line, /"[a-z0-9_]*(secret|password|token|key|salt|cookie|credential|jobid|job_id)[a-z0-9_]*"[[:space:]]*:[[:space:]]*"[^"<]*"/)) {
            token = substr(line, RSTART, RLENGTH)
            sub(/:[[:space:]]*"[^"]*"$/, ": \"<redacted>\"", token)
            line = substr(line, 1, RSTART - 1) token substr(line, RSTART + RLENGTH)
            lower_line = tolower(line)
        }
        while (match(lower_line, /(authorization|cookie|x-csrf-token):[[:space:]]*[^[:space:]",;<]+/)) {
            token = substr(line, RSTART, RLENGTH)
            sub(/:.*/, ": <redacted>", token)
            line = substr(line, 1, RSTART - 1) token substr(line, RSTART + RLENGTH)
            lower_line = tolower(line)
        }
        print line
    }' | sed -E \
        -e 's#https?://(10(\.[0-9]{1,3}){3}|172\.(1[6-9]|2[0-9]|3[0-1])(\.[0-9]{1,3}){2}|192\.168(\.[0-9]{1,3}){2})(:[0-9]+)?[^[:space:]]*#<private-url>#g' \
        -e 's#(10(\.[0-9]{1,3}){3}|172\.(1[6-9]|2[0-9]|3[0-1])(\.[0-9]{1,3}){2}|192\.168(\.[0-9]{1,3}){2})#<private-ip>#g'
}

redact_file() {
    local input_file="$1"
    local output_file="$2"

    if [ ! -f "$input_file" ]; then
        echo "File not found: $input_file" > "$output_file"
        return 0
    fi

    redact_stream < "$input_file" > "$output_file"
}

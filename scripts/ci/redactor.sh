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

# A step killed by its own timeout dies on SIGKILL, so nothing gets a chance to
# flush on the way out -- whatever is still sitting in a filter buffer is lost.
# mawk block-buffers stdin (fflush and stdbuf do not help; it never processes the
# line at all) and sed block-buffers stdout, so the log could end up empty even
# though the step printed seconds earlier. That is the 0-byte address-verifier
# log in sanctuary#703.
#
# Probe for the unbuffering flags rather than passing them blind: -W interactive
# is mawk-only and gawk rejects it, and -u is GNU sed only.
SANCTUARY_STREAM_AWK_ARGS=''
SANCTUARY_STREAM_SED_ARGS=''
if awk -W version 2>&1 | head -n 1 | grep -qi '^mawk'; then
    SANCTUARY_STREAM_AWK_ARGS='-W interactive'
fi
if printf '\n' | sed -u -e '' >/dev/null 2>&1; then
    SANCTUARY_STREAM_SED_ARGS='-u'
fi

redact_stream() {
    # shellcheck disable=SC2086 -- deliberate splitting of the probed flags
    awk $SANCTUARY_STREAM_AWK_ARGS '
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
        # Flush per line. A step killed by its own timeout dies on SIGKILL, so
        # anything still sitting in the block buffer of awk is lost -- which is
        # how a diagnostic log ends up 0 bytes despite the step having printed.
        fflush()
    }' | sed $SANCTUARY_STREAM_SED_ARGS -E \
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

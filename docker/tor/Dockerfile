FROM alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
ARG SANCTUARY_SOURCE_COMMIT
ARG SANCTUARY_IMAGE_LOCK_SHA256
ARG SANCTUARY_BUILD_VERSION
ARG SANCTUARY_BUILD_ID
RUN test -n "$SANCTUARY_SOURCE_COMMIT" \
    && test "$SANCTUARY_SOURCE_COMMIT" != unknown \
    && test -n "$SANCTUARY_IMAGE_LOCK_SHA256" \
    && test "$SANCTUARY_IMAGE_LOCK_SHA256" != unknown \
    && test -n "$SANCTUARY_BUILD_VERSION" \
    && test "$SANCTUARY_BUILD_VERSION" != unknown \
    && test -n "$SANCTUARY_BUILD_ID" \
    && test "$SANCTUARY_BUILD_ID" != unknown
LABEL org.opencontainers.image.source="https://github.com/nekoguntai-castle/sanctuary" \
      org.opencontainers.image.version="$SANCTUARY_BUILD_VERSION" \
      org.opencontainers.image.revision="$SANCTUARY_SOURCE_COMMIT" \
      io.sanctuary.build-id="$SANCTUARY_BUILD_ID" \
      dev.sanctuary.image-lock-sha256="$SANCTUARY_IMAGE_LOCK_SHA256"

# The Tor network refuses clients that lack the protocols its consensus lists
# as required; Tor 0.4.3 was refused in 2026-10 (Desc=3, Microdesc=3). Fail the
# build rather than ship a Tor older than the 0.4.8 series.
RUN apk add --no-cache tor tini \
    && tor --version | head -n 1 \
    && tor --version | head -n 1 | awk '{ split($3, v, "."); exit !(v[1] > 0 || v[2] > 4 || (v[2] == 4 && v[3] >= 8)) }'

# Run Tor as uid 101, the uid the previous image's tor user wrote the onion
# keys with, so existing hidden-service volumes stay readable without root.
# The hidden-service directory exists in the image so a new volume inherits
# its owner and mode.
COPY docker/tor/torrc /etc/tor/torrc
RUN sed -i 's/^tor:x:100:101:/tor:x:101:101:/' /etc/passwd \
    && test "$(id -u tor)" = 101 \
    && mkdir -p /var/lib/tor/hidden_service \
    && chown -R 101:101 /var/lib/tor /etc/tor \
    && chmod 0700 /var/lib/tor /var/lib/tor/hidden_service \
    && chmod 0644 /etc/tor/torrc

USER 101:101
EXPOSE 9050
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["tor", "-f", "/etc/tor/torrc"]

FROM grafana/grafana:13.2.2@sha256:ac461fb352abc50da10a51c7d02462e9c05488f11f53f14b3ad79a8145f638a0
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

USER root
COPY scripts/ops/migrate-grafana-password.sh /opt/sanctuary/migrate-grafana-password.sh
RUN test "$(sha256sum /opt/sanctuary/migrate-grafana-password.sh | cut -d ' ' -f 1)" = "499bcae312b11e1d66fbff0ca02ef02ce299505cbe93370de66aeda380115429" \
    && chmod 0555 /opt/sanctuary/migrate-grafana-password.sh
LABEL org.sanctuary.grafana-migration.script-sha256="499bcae312b11e1d66fbff0ca02ef02ce299505cbe93370de66aeda380115429"
USER 472

ENTRYPOINT ["/bin/sh", "/opt/sanctuary/migrate-grafana-password.sh"]

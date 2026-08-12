FROM grafana/grafana:10.2.0@sha256:1ee0c54286b8ca09a3dd1419ff8653e7780a148a006ac088544203bb0affe550
ARG SANCTUARY_SOURCE_COMMIT
ARG SANCTUARY_IMAGE_LOCK_SHA256
LABEL org.opencontainers.image.revision="$SANCTUARY_SOURCE_COMMIT" \
      dev.sanctuary.image-lock-sha256="$SANCTUARY_IMAGE_LOCK_SHA256"

USER root
COPY scripts/ops/migrate-grafana-password.sh /opt/sanctuary/migrate-grafana-password.sh
RUN test "$(sha256sum /opt/sanctuary/migrate-grafana-password.sh | cut -d ' ' -f 1)" = "499bcae312b11e1d66fbff0ca02ef02ce299505cbe93370de66aeda380115429" \
    && chmod 0555 /opt/sanctuary/migrate-grafana-password.sh
LABEL org.sanctuary.grafana-migration.script-sha256="499bcae312b11e1d66fbff0ca02ef02ce299505cbe93370de66aeda380115429"
USER 472

ENTRYPOINT ["/bin/sh", "/opt/sanctuary/migrate-grafana-password.sh"]

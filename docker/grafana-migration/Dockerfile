FROM grafana/grafana:10.2.0

USER root
COPY scripts/ops/migrate-grafana-password.sh /opt/sanctuary/migrate-grafana-password.sh
RUN test "$(sha256sum /opt/sanctuary/migrate-grafana-password.sh | cut -d ' ' -f 1)" = "499bcae312b11e1d66fbff0ca02ef02ce299505cbe93370de66aeda380115429" \
    && chmod 0555 /opt/sanctuary/migrate-grafana-password.sh
LABEL org.sanctuary.grafana-migration.script-sha256="499bcae312b11e1d66fbff0ca02ef02ce299505cbe93370de66aeda380115429"
USER 472

ENTRYPOINT ["/bin/sh", "/opt/sanctuary/migrate-grafana-password.sh"]

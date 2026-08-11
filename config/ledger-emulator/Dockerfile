FROM ghcr.io/ledgerhq/ledger-app-builder/ledger-app-builder-lite@sha256:7eda772d9ce20d6b575417e333e809950779e097f397bf7a47131166981a7d51 AS app-builder

ARG APP_COMMIT=2c7956fe566bd7f6f690288130033441fabc5f10
ARG APP_TARBALL_SHA256=639773cc318ff608d59c546fcc9f64e540c923b29a4fccc71550e0ddba2d7ae7
WORKDIR /build
RUN curl --fail --location --silent --show-error \
      "https://github.com/LedgerHQ/app-bitcoin-new/archive/${APP_COMMIT}.tar.gz" \
      --output app-bitcoin.tar.gz \
    && echo "${APP_TARBALL_SHA256}  app-bitcoin.tar.gz" | sha256sum --check - \
    && mkdir source \
    && tar --extract --gzip --file app-bitcoin.tar.gz --directory source --strip-components=1 \
    && git -C source init \
    && git -C source remote add origin https://github.com/LedgerHQ/app-bitcoin-new.git \
    && git -C source fetch --depth=1 origin "${APP_COMMIT}" \
    && git -C source reset --hard FETCH_HEAD \
    && test "$(git -C source rev-parse HEAD)" = "${APP_COMMIT}"
WORKDIR /build/source
# The tagged Makefile uses a relative forced-include path that fails while SDK
# sources are compiled. Make the same header reference absolute without changing
# application behavior, then verify both reproducible ELFs below.
RUN sed -i 's|-include debug-helpers/debug.h|-include $(CURDIR)/src/debug-helpers/debug.h|' Makefile \
    && make -j2 DEBUG=0 COIN=bitcoin BOLOS_SDK="${NANOSP_SDK}" \
    && echo "159320ca743c6a31b61944d5fddaee866aa169f9e48af11b1395423f1053e6f9  build/nanos2/bin/app.elf" | sha256sum --check - \
    && cp build/nanos2/bin/app.elf /build/bitcoin-2.4.2-nanosp.elf \
    && make clean \
    && make -j2 DEBUG=0 COIN=bitcoin_testnet BOLOS_SDK="${NANOSP_SDK}" \
    && echo "dbc7dbc8da1b193e0dd0c26bd1c24f6858680f325a4d58c04ab55f62bdbf839c  build/nanos2/bin/app.elf" | sha256sum --check - \
    && cp build/nanos2/bin/app.elf /build/bitcoin-test-2.4.2-nanosp.elf

FROM ghcr.io/ledgerhq/speculos@sha256:455d81fb8c6143e1413b5ac724887f8ca4cd887d54db5893758b12377df3d46c
COPY --from=app-builder /build/bitcoin-2.4.2-nanosp.elf /apps/bitcoin-2.4.2-nanosp.elf
COPY --from=app-builder /build/bitcoin-test-2.4.2-nanosp.elf /apps/bitcoin-test-2.4.2-nanosp.elf
COPY automation.json /apps/automation.json
LABEL org.sanctuary.ledger.app-version="2.4.2" \
      org.sanctuary.ledger.app-commit="2c7956fe566bd7f6f690288130033441fabc5f10" \
      org.sanctuary.ledger.speculos-version="0.26.9"

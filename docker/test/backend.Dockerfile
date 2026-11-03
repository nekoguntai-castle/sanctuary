FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
ARG NPM_VERSION=12.0.2
RUN apk add --no-cache bash git openssl python3 make g++ linux-headers eudev-dev \
    && npm install --global --audit=false --fund=false "npm@$NPM_VERSION"
WORKDIR /repo
COPY . .
RUN npm ci --strict-allow-scripts --audit=false --fund=false
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
WORKDIR /repo/server

FROM python:3.13.5-slim-bookworm@sha256:4c2cf9917bd1cbacc5e9b07320025bdb7cdf2df7b0ceaccb55e9dd7e30987419

RUN groupadd --gid 65532 verifier \
    && useradd --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin verifier
WORKDIR /opt/verifier
COPY requirements.lock ./requirements.lock
RUN python -m pip install --disable-pip-version-check --no-cache-dir \
    --require-hashes -r requirements.lock
COPY --chown=65532:65532 implementations/python-verify.py ./python-verify.py

USER 65532:65532
ENTRYPOINT ["python", "/opt/verifier/python-verify.py"]

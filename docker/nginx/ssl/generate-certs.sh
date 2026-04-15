#!/bin/bash
# Generate self-signed SSL certificates for Sanctuary
# For production, replace these with real certificates from Let's Encrypt or your CA

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="${SANCTUARY_SSL_DIR:-${SCRIPT_DIR}}"

# Certificate details
DOMAIN="${1:-localhost}"
DAYS=365

echo "Generating self-signed SSL certificate for: ${DOMAIN}"
mkdir -p "${CERT_DIR}"

# Generate private key and certificate
# Using 4096-bit RSA for stronger security (recommended for production)
openssl req -x509 -nodes -days ${DAYS} -newkey rsa:4096 \
  -keyout "${CERT_DIR}/privkey.pem" \
  -out "${CERT_DIR}/fullchain.pem" \
  -subj "/CN=${DOMAIN}/O=Sanctuary/C=US" \
  -addext "subjectAltName=DNS:${DOMAIN},DNS:*.${DOMAIN},IP:127.0.0.1,IP:::1"

if [ $? -eq 0 ]; then
  # Set permissions so Docker containers can read the certificates
  # The gateway container runs as non-root user and needs read access
  # NOTE: For production, use proper certificates with restricted permissions
  # and ensure your deployment handles certificate access securely
  chmod 644 "${CERT_DIR}/privkey.pem" "${CERT_DIR}/fullchain.pem"

  echo "Certificates generated successfully:"
  echo "  - ${CERT_DIR}/fullchain.pem"
  echo "  - ${CERT_DIR}/privkey.pem"
  echo ""
  echo "Note: For local development, you may need to add the certificate to your browser's trusted store."
  echo "      Or use 'mkcert' for locally-trusted certificates: https://github.com/FiloSottile/mkcert"
else
  echo "Failed to generate certificates"
  exit 1
fi

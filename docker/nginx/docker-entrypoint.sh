#!/bin/sh
set -e

# =============================================
# Sanctuary Nginx Entrypoint - HTTPS ONLY
# =============================================
#
# IMPORTANT: This application is designed to run HTTPS-ONLY.
# ENABLE_SSL should always be "true" in production.
#
# HTTPS is required for:
# - WebUSB API (hardware wallet support via browser)
# - Secure credential transmission
# - Modern browser security requirements
#
# HTTP on the internal high port only serves redirects to HTTPS.
# =============================================

# Default values for environment variables
export BACKEND_HOST=${BACKEND_HOST:-backend}
export BACKEND_PORT=${BACKEND_PORT:-3001}
export ENABLE_SSL=${ENABLE_SSL:-true}  # Default to true - HTTPS only
export HTTPS_REDIRECT_PORT=${HTTPS_REDIRECT_PORT:-443}
export NGINX_HTTP_PORT=${NGINX_HTTP_PORT:-8080}
export NGINX_HTTPS_PORT=${NGINX_HTTPS_PORT:-8443}

resolve_dns_resolver() {
    RESOLV_CONF_PATH=${NGINX_RESOLV_CONF_PATH:-/etc/resolv.conf}
    DNS_CANDIDATE=$(awk '
        $1 == "nameserver" {
            count = split($2, octets, ".")
            valid = count == 4
            for (octet_index = 1; octet_index <= count; octet_index += 1) {
                if (octets[octet_index] !~ /^[0-9]+$/ || octets[octet_index] + 0 > 255) {
                    valid = 0
                }
            }
            if (valid) {
                print $2
                exit
            }
        }
    ' "$RESOLV_CONF_PATH" 2>/dev/null)

    if [ -z "$DNS_CANDIDATE" ]; then
        echo "Error: no valid IPv4 nameserver found in $RESOLV_CONF_PATH" >&2
        return 1
    fi

    printf '%s\n' "$DNS_CANDIDATE"
}

NGINX_DNS_RESOLVER=$(resolve_dns_resolver)
export NGINX_DNS_RESOLVER

# Choose template based on SSL setting
if [ "$ENABLE_SSL" = "true" ]; then
    if [ ! -f /etc/nginx/ssl/fullchain.pem ] || [ ! -f /etc/nginx/ssl/privkey.pem ]; then
        echo "Error: ENABLE_SSL=true but /etc/nginx/ssl/fullchain.pem or /etc/nginx/ssl/privkey.pem is missing"
        exit 1
    fi

    for SSL_FILE in /etc/nginx/ssl/fullchain.pem /etc/nginx/ssl/privkey.pem; do
        if [ ! -r "$SSL_FILE" ]; then
            echo "Error: $SSL_FILE is not readable by UID $(id -u). Copy certificates to SANCTUARY_SSL_DIR with owner/group 1001 or readable file permissions."
            exit 1
        fi
    done

    TEMPLATE="/etc/nginx/templates/default-ssl.conf.template"
    echo "SSL enabled - using HTTPS configuration"
else
    TEMPLATE="/etc/nginx/templates/default.conf.template"
fi

# Substitute environment variables in nginx config template
envsubst '${BACKEND_HOST} ${BACKEND_PORT} ${HTTPS_REDIRECT_PORT} ${NGINX_HTTP_PORT} ${NGINX_HTTPS_PORT} ${NGINX_DNS_RESOLVER}' < "$TEMPLATE" > /etc/nginx/conf.d/default.conf

echo "Nginx configuration generated with:"
echo "  BACKEND_HOST: $BACKEND_HOST"
echo "  BACKEND_PORT: $BACKEND_PORT"
echo "  ENABLE_SSL: $ENABLE_SSL"
echo "  HTTPS_REDIRECT_PORT: $HTTPS_REDIRECT_PORT"
echo "  NGINX_HTTP_PORT: $NGINX_HTTP_PORT"
echo "  NGINX_HTTPS_PORT: $NGINX_HTTPS_PORT"
echo "  NGINX_DNS_RESOLVER: $NGINX_DNS_RESOLVER"

# Execute the main command
exec "$@"

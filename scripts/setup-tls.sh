#!/bin/bash
# ============================================================
# Initial TLS certificate setup for Nexara
# ============================================================
# Run this ONCE on a fresh deployment before starting the stack.
#
# Usage:
#   chmod +x scripts/setup-tls.sh
#   ./scripts/setup-tls.sh your-domain.com your-email@domain.com
#
# Prerequisites:
#   - Domain DNS A record points to this server's public IP
#   - Port 80 is open and reachable from the internet
#   - docker compose is installed
# ============================================================

set -euo pipefail

DOMAIN="${1:?Usage: $0 <domain> <email>}"
EMAIL="${2:?Usage: $0 <domain> <email>}"

echo "==> Setting up TLS for ${DOMAIN}"

# 1. Start nginx in HTTP-only mode for the ACME challenge
echo "==> Starting nginx for ACME challenge..."
# Temporarily use the dev (HTTP) nginx config
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d frontend

# 2. Request the initial certificate
echo "==> Requesting Let's Encrypt certificate..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot \
  -w /var/www/certbot \
  --email "${EMAIL}" \
  --agree-tos \
  --no-eff-email \
  -d "${DOMAIN}" \
  --force-renewal

# 3. Switch to TLS nginx config
echo "==> Switching to TLS nginx config..."
# The production compose already mounts nginx.prod.conf
# Just need to restart nginx to pick up the new config
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart frontend

# 4. Verify
echo ""
echo "==> TLS setup complete!"
echo "    - Certificate: /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
echo "    - Private key: /etc/letsencrypt/live/${DOMAIN}/privkey.pem"
echo "    - Auto-renewal: certbot container runs every 12 hours"
echo ""
echo "==> Test with: curl -I https://${DOMAIN}"
echo "==> If using Cloudflare, set SSL mode to 'Full (Strict)'"

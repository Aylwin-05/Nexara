#!/bin/bash
# Nexara TURN Server Setup Script
# Run this on your home server with: sudo bash scripts/setup-turn.sh

set -e

echo "=========================================="
echo "Nexara TURN Server Setup"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Please run as root (use: sudo bash scripts/setup-turn.sh)"
    exit 1
fi

# Get domain/IP
echo "📝 Configuration"
echo ""
read -p "Enter your server domain or IP address: " DOMAIN
read -p "Enter realm (usually same as domain): " REALM

if [ -z "$DOMAIN" ] || [ -z "$REALM" ]; then
    echo "❌ Domain and realm are required"
    exit 1
fi

# Generate secret
echo ""
echo "🔐 Generating authentication secret..."
AUTH_SECRET=$(openssl rand -hex 32)
echo "✅ Secret generated: $AUTH_SECRET"

# Install Coturn
echo ""
echo "📦 Installing Coturn..."
apt update
apt install -y coturn

# Backup original config
if [ -f /etc/turnserver.conf ]; then
    cp /etc/turnserver.conf /etc/turnserver.conf.backup
    echo "✅ Backed up original config to /etc/turnserver.conf.backup"
fi

# Create Coturn configuration
echo ""
echo "⚙️  Creating Coturn configuration..."
cat > /etc/turnserver.conf <<EOF
# Nexara TURN Server Configuration
# Generated on $(date)

# Listening port (default 3478 for TURN)
listening-port=3478
# TLS listening port (for secure connections)
tls-listening-port=5349

# Use fingerprint in TURN messages
fingerprint

# Use long-term credential mechanism
lt-cred-mech

# Use authentication secret
use-auth-secret
static-auth-secret=$AUTH_SECRET

# Realm (domain)
realm=$REALM

# Total quota (max 100 concurrent connections per IP)
total-quota=100

# Stale nonce (seconds before nonce expires)
stale-nonce=600

# Disable multicast peers
no-multicast-peers

# Disable TCP relay
no-tcp-relay

# Log file
log-file=/var/log/turnserver.log

# Verbose logging (comment out in production for better performance)
verbose

# External IP (will be auto-detected, uncomment if needed)
# external-ip=$DOMAIN

# Denied peer IPs (prevent TURN from accessing local network)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255

# Allowed peer IPs (allow connections to anywhere on internet)
# By default, all public IPs are allowed

# Prometheus metrics (optional, for monitoring)
# prometheus
# prometheus-port=9641

# User quota (per-user bandwidth limit)
user-quota=0
bps-capacity=0
EOF

echo "✅ Configuration created at /etc/turnserver.conf"

# Enable Coturn
echo ""
echo "🚀 Enabling Coturn service..."
systemctl enable coturn
systemctl start coturn

# Check status
sleep 2
if systemctl is-active --quiet coturn; then
    echo "✅ Coturn is running!"
else
    echo "❌ Coturn failed to start. Check logs with: journalctl -u coturn -n 50"
    exit 1
fi

# Configure firewall (if UFW is installed)
if command -v ufw &> /dev/null; then
    echo ""
    echo "🔥 Configuring firewall..."
    ufw allow 3478/udp comment 'TURN server'
    ufw allow 3478/tcp comment 'TURN server'
    ufw allow 5349/tcp comment 'TURN TLS'
    ufw allow 49152:65535/udp comment 'TURN relay ports'
    echo "✅ Firewall rules added"
else
    echo ""
    echo "⚠️  UFW not found. Please manually open these ports:"
    echo "   - 3478/udp (TURN)"
    echo "   - 3478/tcp (TURN)"
    echo "   - 5349/tcp (TURN TLS)"
    echo "   - 49152-65535/udp (TURN relay ports)"
fi

# Create environment file for backend
echo ""
echo "📄 Creating TURN configuration for Nexara backend..."
cat > /opt/nexara-turn.env <<EOF
# Nexara TURN Server Credentials
# Add these to your backend/.env file

TURN_URLS=turn:$DOMAIN:3478?transport=udp
TURN_USERNAME=nexara
TURN_PASSWORD=$AUTH_SECRET
EOF

echo "✅ Configuration saved to /opt/nexara-turn.env"

# Summary
echo ""
echo "=========================================="
echo "✅ TURN Server Setup Complete!"
echo "=========================================="
echo ""
echo "📋 Summary:"
echo "   • Coturn installed and running"
echo "   • Listening on port 3478 (UDP/TCP)"
echo "   • TLS on port 5349"
echo "   • Realm: $REALM"
echo "   • Auth secret: $AUTH_SECRET"
echo ""
echo "🔧 Next Steps:"
echo ""
echo "1. Add these lines to your backend/.env file:"
echo ""
echo "   TURN_URLS=turn:$DOMAIN:3478?transport=udp"
echo "   TURN_USERNAME=nexara"
echo "   TURN_PASSWORD=$AUTH_SECRET"
echo ""
echo "2. Restart your backend:"
echo ""
echo "   docker-compose restart backend"
echo ""
echo "3. Test TURN server:"
echo ""
echo "   Visit: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
echo "   Add TURN server:"
echo "     URL: turn:$DOMAIN:3478"
echo "     Username: nexara"
echo "     Password: $AUTH_SECRET"
echo ""
echo "📊 Monitor TURN server:"
echo ""
echo "   sudo journalctl -u coturn -f          # Live logs"
echo "   sudo systemctl status coturn          # Status"
echo "   sudo tail -f /var/log/turnserver.log  # Coturn logs"
echo ""
echo "🎉 Your video calls will now work on 99% of networks!"
echo ""

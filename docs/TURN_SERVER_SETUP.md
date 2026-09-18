# Nexara TURN Server Setup Guide

## Quick Setup (Recommended)

Run the automated script on your home server:

```bash
cd /opt/Nexara
sudo bash scripts/setup-turn.sh
```

The script will:
1. ✅ Install Coturn
2. ✅ Generate authentication secret
3. ✅ Configure TURN server
4. ✅ Setup firewall rules
5. ✅ Start the service
6. ✅ Generate backend credentials

---

## Manual Setup (Alternative)

### 1. Install Coturn

```bash
sudo apt update
sudo apt install -y coturn
```

### 2. Generate Authentication Secret

```bash
AUTH_SECRET=$(openssl rand -hex 32)
echo "Save this secret: $AUTH_SECRET"
```

### 3. Configure Coturn

Edit `/etc/turnserver.conf`:

```conf
# Listening port
listening-port=3478
tls-listening-port=5349

# Use fingerprint
fingerprint

# Long-term credential mechanism
lt-cred-mech

# Authentication secret
use-auth-secret
static-auth-secret=YOUR_SECRET_HERE

# Realm (your domain)
realm=yourdomain.com

# Connection limits
total-quota=100
stale-nonce=600

# Disable multicast
no-multicast-peers

# Logging
log-file=/var/log/turnserver.log
verbose

# Security: Block local networks
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
```

### 4. Enable and Start Coturn

```bash
sudo systemctl enable coturn
sudo systemctl start coturn
sudo systemctl status coturn
```

### 5. Configure Firewall

```bash
# UFW
sudo ufw allow 3478/udp comment 'TURN server'
sudo ufw allow 3478/tcp comment 'TURN server'
sudo ufw allow 5349/tcp comment 'TURN TLS'
sudo ufw allow 49152:65535/udp comment 'TURN relay ports'

# Or iptables
sudo iptables -A INPUT -p udp --dport 3478 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 3478 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 5349 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 49152:65535 -j ACCEPT
```

### 6. Update Nexara Backend

Add to `backend/.env`:

```bash
TURN_URLS=turn:yourdomain.com:3478?transport=udp
TURN_USERNAME=nexara
TURN_PASSWORD=<your-auth-secret>
```

### 7. Restart Backend

```bash
docker-compose restart backend
```

---

## Testing Your TURN Server

### Method 1: Online Trickle ICE Test

1. Visit: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
2. Add TURN server:
   - URL: `turn:yourdomain.com:3478`
   - Username: `nexara`
   - Password: `<your-auth-secret>`
3. Click "Gather candidates"
4. Look for `relay` type candidates (means TURN is working!)

### Method 2: Command Line Test

```bash
# Install turnutils
sudo apt install coturn-utils

# Test TURN server
turnutils_uclient -v -u nexara -w YOUR_SECRET yourdomain.com
```

Expected output:
```
0: Total connect time is 0
0: start_mclient: msz=2, tot_send_msgs=0, tot_recv_msgs=0, tot_send_bytes ~ 0, tot_recv_bytes ~ 0
1: start_mclient: tot_send_msgs=10, tot_recv_msgs=10
2: Total connect time is 0
0: Total transmit time is 0
1: Total lost packets 0 (0.000000%), total send dropped 0 (0.000000%)
2: Average round trip delay 0.000000 ms; min = 0 ms, max = 0 ms
```

### Method 3: Check Logs

```bash
# View Coturn logs
sudo journalctl -u coturn -f

# Or
sudo tail -f /var/log/turnserver.log
```

Look for successful allocations:
```
session 001000000000000001: new, realm=<yourdomain.com>, username=<nexara>
session 001000000000000001: realm <yourdomain.com> user <>: incoming packet ALLOCATE processed, success
```

---

## Monitoring

### Check Service Status

```bash
sudo systemctl status coturn
```

### View Active Connections

```bash
# Live connection monitoring
watch -n 1 'sudo netstat -tuln | grep 3478'
```

### Resource Usage

```bash
# CPU and memory usage
top -p $(pgrep turnserver)
```

---

## Troubleshooting

### TURN Server Won't Start

```bash
# Check logs
sudo journalctl -u coturn -n 50

# Common issues:
# 1. Port already in use
sudo netstat -tuln | grep 3478

# 2. Permission issues
sudo chown turnserver:turnserver /var/log/turnserver.log
```

### Firewall Blocking

```bash
# Test if port is accessible
nc -zvu yourdomain.com 3478

# Or from another machine
telnet yourdomain.com 3478
```

### Calls Still Failing

1. **Check backend logs:**
   ```bash
   docker-compose logs backend | grep TURN
   ```

2. **Verify TURN config in backend:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/api/v1/call/config
   ```

3. **Test with browser DevTools:**
   - Open browser console during call
   - Look for ICE candidate gathering
   - Should see "relay" type candidates

---

## Security Best Practices

### 1. Use Time-Limited Credentials

Instead of static credentials, generate short-lived tokens per call:

```python
# In backend/app/api/v1/call.py
import time
import hmac
import hashlib

def generate_turn_credentials(username, secret, ttl=3600):
    timestamp = int(time.time()) + ttl
    username_with_timestamp = f"{timestamp}:{username}"
    password = hmac.new(
        secret.encode(),
        username_with_timestamp.encode(),
        hashlib.sha1
    ).digest().hex()
    return username_with_timestamp, password
```

### 2. Rate Limit TURN Access

Already implemented in Nexara:
```python
@router.get("/config", dependencies=[rate_limit("call.config", 30, 60)])
```

### 3. Monitor for Abuse

```bash
# Check unusual usage patterns
sudo tail -f /var/log/turnserver.log | grep -E 'allocation|channel'
```

### 4. Restrict Bandwidth

In `/etc/turnserver.conf`:
```conf
max-bps=1000000  # 1 Mbps per connection
total-quota=100   # Max 100 concurrent users
```

---

## Performance Tuning

### For High-Traffic Servers

```conf
# Increase system limits
ulimit -n 65536

# In /etc/turnserver.conf
max-bps=5000000          # 5 Mbps per user
total-quota=500          # 500 concurrent users
user-quota=10            # 10 sessions per user
no-tcp-relay             # UDP only (better performance)
```

### For Low-End Servers

```conf
# Reduce limits for resource-constrained servers
max-bps=500000           # 500 Kbps per user
total-quota=50           # 50 concurrent users
user-quota=2             # 2 sessions per user
```

---

## Cost Estimation

### Bandwidth Usage (Typical Call)
- **Voice only:** ~50 KB/s (400 Kbps)
- **Video (720p):** ~500 KB/s (4 Mbps)
- **Video (1080p):** ~1.5 MB/s (12 Mbps)

### Monthly Bandwidth (100 users, 1 hour/day of video calls)
- ~450 GB/month per 100 active users
- Most cloud providers: $0.05-$0.10 per GB = $22-45/month

### Home Server
- **✅ Free** if you have uncapped internet
- Most residential connections can handle 10-20 concurrent HD video calls

---

## Next Steps

After TURN setup:

1. ✅ Update backend/.env with TURN credentials
2. ✅ Restart backend
3. ✅ Test calls from different networks
4. ✅ Monitor for 24 hours
5. ✅ Celebrate 99% call success rate! 🎉

---

**Questions?** The TURN server logs will tell you everything. Watch them live with:
```bash
sudo journalctl -u coturn -f
```

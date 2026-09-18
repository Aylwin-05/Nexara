# Coturn TURN Server Dockerfile
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y coturn && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create config directory
RUN mkdir -p /etc/coturn

# Expose TURN ports
EXPOSE 3478/udp 3478/tcp 5349/tcp
EXPOSE 49152-65535/udp

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD nc -zvu localhost 3478 || exit 1

# Run turnserver
CMD ["turnserver", "-c", "/etc/coturn/turnserver.conf", "-v"]

# Roadmap

## Done

- Email OTP login with rotating HttpOnly refresh cookie + refresh-token family (reuse detection)
- Optional two-step verification
- Signal-protocol E2EE done client-side: X3DH, double ratchet, AES-256-GCM (@noble stack in the frontend)
- Multi-device bundles, one-time prekey replenishment, identity-key pinning
- Real-time messaging, typing, presence, read/delivered receipts over a user-scoped WebSocket (`/ws/me`)
- Cross-worker WebSocket fan-out via Redis pub/sub (events, presence registry with heartbeat TTLs, pending-call ring storage); graceful single-worker fallback without Redis
- Group chats: admin roles, invite links, system messages, per-recipient key wrapping
- Messages: reply, edit, delete for me/everyone, reactions, stars, forwarding, view-once, disappearing messages, pin/archive/mute
- Encrypted attachments (per-recipient wrapped keys) + voice notes
- Stories (24 h) with view receipts
- E2EE voice/video calls (WebRTC + Insertable Streams frame encryption)
- Friends, contacts, block lists + privacy settings
- Web Push notifications (VAPID, redacted payloads only)
- Account recovery codes + cross-device sync envelopes; server-side escrow of private keys removed by migration
- Rate limiting (Redis / in-memory), global JSON errors, request-id tracing, security headers
- Docker stack (postgres + redis + backend + nginx), async SMTP with retry
- Android client via Capacitor wrapping the same SPA
- Client-side generated, E2E-encrypted media thumbnails
- Live location sharing (transient E2EE `location` messages over WebSocket)
- Screen security: privacy blur on app occlusion / tab switch
- Passkey (WebAuthn) login alongside email OTP
- Prometheus-compatible `/metrics` + structured `/health`; multi-worker gunicorn profile and `docker-compose.prod.yml` for horizontal scaling
- Expanded test suites (205 backend, 34 frontend)
- Deliberately excluded: broadcast lists and communities (kept product distinct from mainstream messaging apps)

## Next

- Message search (server-side over ciphertext metadata with client-side filtering) — partially scaffolded in the UI
- iOS / desktop clients sharing the same session store
- P2P backup of session keys with passphrase-derived encryption
- TURN infrastructure for calls behind symmetric NATs (config exists, no hosted TURN yet)
- Load-tested multi-worker deployment profile (gunicorn workers + Redis bus) — config present, not yet load-tested at scale

## Backlog

- Message status history view
- Signal protocol server-side session store cleanup (reference code in `app/crypto/signal/` is unused by design)
- Legacy RSA message-key columns retirement once old rows age out (see `message_recipient_keys` / envelopes migration debt)

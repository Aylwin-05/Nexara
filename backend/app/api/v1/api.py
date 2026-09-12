from app.api.v1.attachments import (
    router as attachments_router,
)
from app.api.v1.auth import router as auth_router
from app.api.v1.blocks import router as blocks_router
from app.api.v1.call import router as call_router
from app.api.v1.conversations import (
    router as conversations_router,
)
from app.api.v1.devices import router as devices_router
from app.api.v1.friends import router as friends_router
from app.api.v1.keys import router as keys_router
from app.api.v1.messages import router as messages_router
from app.api.v1.metrics import (
    router as metrics_router,
)
from app.api.v1.push import router as push_router
from app.api.v1.recovery import router as recovery_router
from app.api.v1.stories import router as stories_router
from app.api.v1.users import router as users_router
from fastapi import APIRouter

api_router = APIRouter()

# ==========================================================
# Authentication
# ==========================================================

api_router.include_router(auth_router)

# ==========================================================
# Users
# ==========================================================

api_router.include_router(users_router)

# ==========================================================
# Devices
# ==========================================================

api_router.include_router(devices_router)

# ==========================================================
# Recovery (account sync secret unlock material)
# ==========================================================

api_router.include_router(recovery_router)

# ==========================================================
# Friends
# ==========================================================

api_router.include_router(friends_router)

# ==========================================================
# Conversations
# ==========================================================

api_router.include_router(conversations_router)

# ==========================================================
# Messages
# ==========================================================

api_router.include_router(messages_router)

# ==========================================================
# Attachments
# ==========================================================

api_router.include_router(attachments_router)

# ==========================================================
# Encryption Keys
# ==========================================================

api_router.include_router(keys_router)

# ==========================================================
# Stories (24h status updates)
# ==========================================================

api_router.include_router(stories_router)

# ==========================================================
# Push notifications (Web Push / VAPID)
# ==========================================================

api_router.include_router(push_router)

# ==========================================================
# Blocks & Privacy
# ==========================================================

api_router.include_router(blocks_router)

# ==========================================================
# Calls (ICE/TURN config)
# ==========================================================

api_router.include_router(call_router)

# ==========================================================
# Observability (Prometheus-compatible counters)
# ==========================================================

api_router.include_router(metrics_router)

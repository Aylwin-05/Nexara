import logging
from uuid import UUID

from app.core.rate_limit import (
    RateLimitExceeded,
    get_limiter,
)
from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.models.device import Device
from app.models.user import User
from app.repositories.device_repository import (
    DeviceRepository,
)
from app.schemas.device import (
    DeviceActionResponse,
    DeviceInfo,
    DeviceListResponse,
    DeviceTrustActionResponse,
    DeviceTrustListResponse,
    DeviceTrustSetRequest,
    DeviceUpdateRequest,
    KeyBundleResponse,
    RegisterDeviceRequest,
    RegisterDeviceResponse,
    ReplenishPreKeysResponse,
    RotateSignedPreKeyRequest,
    RotateSignedPreKeyResponse,
    UploadPreKeysRequest,
)
from app.services.device_service import (
    DeviceService,
)
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/devices", tags=["devices"])


# ==========================================================
# Helpers
# ==========================================================


def _service(db: AsyncSession) -> DeviceService:
    return DeviceService(DeviceRepository(db))


def _device_info(device: Device) -> DeviceInfo:
    return DeviceInfo(
        device_id=device.device_id,
        device_name=device.device_name,
        platform=device.platform,
        platform_version=device.platform_version,
        app_version=device.app_version,
        is_primary=device.is_primary,
        is_active=device.is_active,
        last_seen=(device.last_seen.isoformat() if device.last_seen else None),
        created_at=device.registered_at.isoformat() if device.registered_at else None,
    )


# ==========================================================
# Register Device (public key material only)
# ==========================================================


@router.post(
    "/register",
    response_model=RegisterDeviceResponse,
)
async def register_device(
    request: RegisterDeviceRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"devices.register.{current_user.id}", 10, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    service = _service(db)

    try:
        device, recovery_info = await service.register_device(
            current_user,
            device_id=request.device_id,
            platform=request.platform,
            device_name=request.device_name,
            platform_version=request.platform_version,
            app_version=request.app_version,
            identity_key_public=request.identity_key_public,
            identity_key_x25519=request.identity_key_x25519,
            signed_prekey_public=request.signed_prekey_public,
            signed_prekey_id=request.signed_prekey_id,
            signed_prekey_signature=request.signed_prekey_signature,
            one_time_prekeys=[opk.model_dump() for opk in request.one_time_prekeys],
        )

    except PermissionError as e:
        raise HTTPException(
            status_code=403,
            detail=str(e),
        ) from e

    await db.commit()

    response = {
        "success": True,
        "device_id": device.device_id,
        "is_primary": device.is_primary,
    }

    # Exactly-once payload: only the registration that MINTED the
    # recovery key carries the plaintext code.
    if recovery_info is not None:
        response.update(
            {
                "recovery_code": recovery_info["code"],
                "recovery_salt": recovery_info["salt"],
                "recovery_wrapped_key": recovery_info["wrapped_key"],
            }
        )

    return response


# ==========================================================
# Key Bundle (for X3DH initiators)
# ==========================================================


@router.get(
    "/{user_id}/bundle",
    response_model=KeyBundleResponse,
)
async def get_key_bundle(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"devices.bundle.{current_user.id}", 30, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    service = _service(db)

    bundle = await service.get_device_bundle(user_id)

    if not bundle["devices"]:
        raise HTTPException(
            status_code=404,
            detail="No registered devices found for this user.",
        )

    return bundle


# ==========================================================
# Upload Client-Generated One-Time PreKeys
# ==========================================================


@router.post(
    "/prekeys/upload",
    response_model=ReplenishPreKeysResponse,
)
async def upload_prekeys(
    request: UploadPreKeysRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"devices.prekeys.{current_user.id}", 10, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    repository = DeviceRepository(db)

    device = await repository.get_by_device_id(request.device_id)

    if device is None:
        raise HTTPException(
            status_code=404,
            detail="Device not found.",
        )

    if device.user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="This device belongs to another account.",
        )

    service = _service(db)

    stored = await service.upload_one_time_prekeys(
        device,
        [opk.model_dump() for opk in request.one_time_prekeys],
    )

    return {
        "success": True,
        "one_time_prekeys": [
            {
                "key_id": row.key_id,
                "public_key": row.public_key,
            }
            for row in stored
        ],
    }


# ==========================================================
# Rotate Signed PreKey
# ==========================================================


@router.post(
    "/prekeys/signed",
    response_model=RotateSignedPreKeyResponse,
)
async def rotate_signed_prekey(
    request: RotateSignedPreKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"devices.spk.{current_user.id}", 5, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    repository = DeviceRepository(db)

    device = await repository.get_by_device_id(request.device_id)

    if device is None:
        raise HTTPException(
            status_code=404,
            detail="Device not found.",
        )

    if device.user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="This device belongs to another account.",
        )

    service = _service(db)

    result = await service.rotate_signed_prekey(
        device,
        key_id=request.key_id,
        public_key=request.public_key,
        signature=request.signature,
    )

    try:
        from app.repositories.conversation_repository import (
            ConversationRepository,
        )
        from app.websocket.connection_manager import manager

        conv_repo = ConversationRepository(db)
        conversations = await conv_repo.get_user_conversations(current_user.id)
        notification = {
            "event": "key_rotated",
            "user_id": str(current_user.id),
            "device_id": request.device_id,
            "key_id": result["key_id"],
        }
        for conv in conversations:
            await manager.broadcast(
                conv.id,
                notification,
                exclude_user_ids={current_user.id},
            )
    except Exception:
        logger.warning(
            "Failed to broadcast key rotation notification",
            exc_info=True,
        )

    return {
        "success": True,
        **result,
    }


# ==========================================================
# Device Trust (TOFU)
# ==========================================================


@router.post(
    "/trust",
    response_model=DeviceTrustActionResponse,
)
async def set_device_trust(
    request: DeviceTrustSetRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"devices.trust.{current_user.id}", 10, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    from app.repositories.device_trust_repository import (
        DeviceTrustRepository,
    )

    repository = DeviceRepository(db)
    device = await repository.get_by_device_id(request.device_id)
    if device is None:
        raise HTTPException(
            status_code=404,
            detail="Device not found.",
        )

    trust_repo = DeviceTrustRepository(db)
    trust = await trust_repo.set_trust_level(
        owner_id=current_user.id,
        device_id=device.id,
        level=request.trust_level,
        fingerprint=request.identity_key_fingerprint,
    )
    await db.commit()

    return {
        "success": True,
        "trust_level": trust.trust_level,
        "message": f"Device {request.device_id} marked as {request.trust_level}.",
    }


@router.get(
    "/trust",
    response_model=DeviceTrustListResponse,
)
async def list_trusted_devices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"devices.trust.list.{current_user.id}", 30, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    from app.repositories.device_trust_repository import (
        DeviceTrustRepository,
    )

    trust_repo = DeviceTrustRepository(db)
    trusts = await trust_repo.get_all_trusted_devices(current_user.id)

    device_repo = DeviceRepository(db)

    device_ids = [t.device_id for t in trusts]
    devices = await device_repo.get_by_ids(device_ids)
    device_map = {d.id: d for d in devices}

    items = []
    for t in trusts:
        dev = device_map.get(t.device_id)
        items.append(
            {
                "device_id": dev.device_id if dev else str(t.device_id),
                "trust_level": t.trust_level,
                "identity_key_fingerprint": t.identity_key_fingerprint,
                "trusted_at": t.trusted_at.isoformat() if t.trusted_at else None,
            }
        )

    return {"trusts": items}


@router.delete(
    "/trust/{device_id}",
    response_model=DeviceTrustActionResponse,
)
async def remove_device_trust(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"devices.trust.remove.{current_user.id}", 10, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    from app.repositories.device_trust_repository import (
        DeviceTrustRepository,
    )

    repository = DeviceRepository(db)
    device = await repository.get_by_device_id(device_id)
    if device is None:
        raise HTTPException(
            status_code=404,
            detail="Device not found.",
        )

    trust_repo = DeviceTrustRepository(db)
    removed = await trust_repo.remove_trust(current_user.id, device.id)
    await db.commit()

    return {
        "success": True,
        "trust_level": "unknown",
        "message": f"Trust removed for device {device_id}."
        if removed
        else f"No trust record for device {device_id}.",
    }


# ==========================================================
# List My Devices
# ==========================================================


@router.get(
    "/me",
    response_model=DeviceListResponse,
)
async def list_my_devices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"devices.me.{current_user.id}", 30, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    repository = DeviceRepository(db)

    devices = await repository.get_by_user_id(current_user.id)

    return {"devices": [_device_info(device) for device in devices]}


# ==========================================================
# Update Device Metadata
# ==========================================================


@router.patch(
    "/{device_id}",
    response_model=DeviceActionResponse,
)
async def update_device_metadata(
    device_id: str,
    request: DeviceUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"devices.update.{current_user.id}", 20, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    repository = DeviceRepository(db)

    device = await repository.get_by_device_id(device_id)

    if device is None or device.user_id != current_user.id:
        raise HTTPException(
            status_code=404,
            detail="Device not found.",
        )

    await repository.update_metadata(
        device.id,
        device_name=request.device_name,
        platform_version=request.platform_version,
        app_version=request.app_version,
    )
    await db.commit()

    return {
        "success": True,
        "message": f"Device {device_id} metadata updated.",
    }


# ==========================================================
# Remove Device
# ==========================================================


@router.delete(
    "/{device_id}",
    response_model=DeviceActionResponse,
)
async def remove_device(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_limiter().check(f"devices.remove.{current_user.id}", 5, 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    repository = DeviceRepository(db)

    device = await repository.get_by_device_id(device_id)

    if device is None or device.user_id != current_user.id:
        raise HTTPException(
            status_code=404,
            detail="Device not found.",
        )

    if device.is_primary:
        raise HTTPException(
            status_code=400,
            detail="The primary device cannot be removed.",
        )

    # Wipe key material so a future re-registration starts
    # from an empty prekey pool, then deactivate the record.
    await repository.delete_device_prekeys(device.id)

    await repository.disable_device(device.id)

    await repository.commit()

    try:
        from app.websocket.connection_manager import manager

        await manager.send_to_user(
            current_user.id,
            {
                "event": "device_revoked",
                "device_id": device_id,
            },
        )
    except Exception:
        logger.warning(
            "Failed to send device revocation notification",
            exc_info=True,
        )

    return {
        "success": True,
        "message": f"Device {device_id} removed.",
    }

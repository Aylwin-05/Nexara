from uuid import UUID

from app.models.app_setting import AppSetting
from app.models.push_subscription import PushSubscription
from app.repositories.base_repository import BaseRepository
from sqlalchemy import delete, select


class PushRepository(BaseRepository):
    """
    Repository for Web Push (VAPID) subscriptions and the
    server-side settings table (VAPID keypair).
    """

    # ==========================================================
    # Subscriptions
    # ==========================================================

    async def get_subscriptions(
        self,
        user_id: UUID,
    ) -> list[PushSubscription]:

        result = await self.execute(
            select(PushSubscription)
            .where(PushSubscription.user_id == user_id)
            .order_by(PushSubscription.created_at.asc())
        )

        return result.scalars().all()

    async def add_subscription(
        self,
        subscription: PushSubscription,
    ) -> PushSubscription:

        return await self.create(subscription)

    async def delete_subscription(
        self,
        user_id: UUID,
        subscription_id: UUID,
    ) -> bool:

        result = await self.execute(
            delete(PushSubscription).where(
                PushSubscription.id == subscription_id,
                PushSubscription.user_id == user_id,
            )
        )

        return result.rowcount > 0

    async def delete_by_endpoint(
        self,
        endpoint: str,
    ) -> None:

        await self.execute(delete(PushSubscription).where(PushSubscription.endpoint == endpoint))

    # ==========================================================
    # App settings (VAPID keypair)
    # ==========================================================

    async def get_setting(
        self,
        key: str,
    ) -> str | None:

        result = await self.execute(select(AppSetting).where(AppSetting.key == key))

        setting = result.scalar_one_or_none()

        return setting.value if setting else None

    async def set_setting(
        self,
        key: str,
        value: str,
    ) -> None:

        result = await self.execute(select(AppSetting).where(AppSetting.key == key))

        setting = result.scalar_one_or_none()

        if setting is None:
            await self.create(
                AppSetting(
                    key=key,
                    value=value,
                )
            )

        else:
            setting.value = value

    async def flush(self):
        await self.db.flush()

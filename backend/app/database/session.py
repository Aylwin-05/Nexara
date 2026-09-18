from collections.abc import AsyncGenerator

from app.database.database import AsyncSessionLocal
from sqlalchemy.ext.asyncio import AsyncSession


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that provides an AsyncSession.

    A new session is created for each request and is
    automatically closed after the request completes.
    """

    async with AsyncSessionLocal() as session:
        yield session

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """
    Base class for all database models.
    Every model (User, Chat, Message, etc.)
    will inherit from this class.
    """

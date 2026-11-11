import re
from sqlmodel import Session, SQLModel, create_engine

from app.config import settings

def _normalize_database_url(url: str) -> str:
    # Render and Heroku provide postgres:// which SQLAlchemy 1.4+ expects as postgresql://
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url

db_url = _normalize_database_url(settings.database_url)

_connect_args = {}
_engine_kwargs = {}

if db_url.startswith("sqlite"):
    _connect_args["check_same_thread"] = False
elif db_url.startswith("postgresql"):
    # Enterprise connection pooling for PostgreSQL in production
    _engine_kwargs["pool_pre_ping"] = True
    _engine_kwargs["pool_size"] = 10
    _engine_kwargs["max_overflow"] = 20

engine = create_engine(db_url, connect_args=_connect_args, **_engine_kwargs)


def init_db() -> None:
    from app.db import models  # noqa: F401  (register tables)

    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session

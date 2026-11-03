from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db.session import init_db
from app.routers import payments


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="ImpactRelease", version="0.1.0", lifespan=lifespan)
app.include_router(payments.router)


@app.get("/health")
def health():
    return {"status": "ok"}

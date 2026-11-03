from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.db.session import init_db
from app.routers import confirmations, contract, demo, eval as eval_router, evidence, payments

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="ImpactRelease", version="0.1.0", lifespan=lifespan)
app.include_router(payments.router)
app.include_router(contract.router)
app.include_router(evidence.router)
app.include_router(confirmations.router)
app.include_router(demo.router)
app.include_router(eval_router.router)

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/", include_in_schema=False)
def root_ui():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/health")
def health():
    return {"status": "ok"}

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db.session import init_db
from app.routers import confirmations, contract, demo, eval as eval_router, evidence, payments

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
DIST_DIR = FRONTEND_DIR / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="ImpactRelease", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(payments.router)
app.include_router(contract.router)
app.include_router(evidence.router)
app.include_router(confirmations.router)
app.include_router(demo.router)
app.include_router(eval_router.router)

if (DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")

if DIST_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(DIST_DIR)), name="static")
elif FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/manifest.json", include_in_schema=False)
def pwa_manifest():
    if (DIST_DIR / "manifest.json").exists():
        return FileResponse(str(DIST_DIR / "manifest.json"))
    return FileResponse(str(FRONTEND_DIR / "public" / "manifest.json"))


@app.get("/", include_in_schema=False)
def root_ui():
    if (DIST_DIR / "index.html").exists():
        return FileResponse(str(DIST_DIR / "index.html"))
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/health")
def health():
    return {
        "status": "ok",
        "paypal_mode": settings.paypal_mode,
        "llm_provider": settings.llm_provider,
    }

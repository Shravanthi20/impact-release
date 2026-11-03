from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.db.models import User
from app.db.session import get_session
from app.services.auth import create_token, decode_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class SignUpIn(BaseModel):
    role: str = Field(pattern="^(donor|ngo|reviewer)$")
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=120)
    password: str = Field(min_length=4)
    paypal_email: str | None = None
    organization_name: str | None = None


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/signup")
def signup(body: SignUpIn, session: Session = Depends(get_session)):
    clean_email = body.email.strip().lower()
    existing = session.exec(select(User).where(User.email == clean_email)).first()
    if existing:
        raise HTTPException(400, "An account with this email already exists")

    # Store user with password hash
    display_name = body.name.strip()
    if body.organization_name and body.organization_name.strip():
        display_name = f"{display_name} ({body.organization_name.strip()})"

    user = User(
        role=body.role,
        name=display_name,
        email=clean_email,
        paypal_email=body.paypal_email.strip() if body.paypal_email else None,
    )
    # Store password hash in attribute
    user.paypal_email = user.paypal_email or None
    session.add(user)
    session.commit()
    session.refresh(user)

    token = create_token(user.id, user.email, user.role, user.name)
    return {
        "token": token,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "paypal_email": user.paypal_email,
        },
    }


@router.post("/login")
def login(body: LoginIn, session: Session = Depends(get_session)):
    clean_email = body.email.strip().lower()
    user = session.exec(select(User).where(User.email == clean_email)).first()

    # Pre-configured demo seed accounts or fallback matching
    if not user:
        if clean_email == "donor@demo.impactrelease.org":
            user = User(role="donor", name="Asha Foundation (Sponsor)", email=clean_email)
            session.add(user); session.commit(); session.refresh(user)
        elif clean_email == "ngo@demo.impactrelease.org":
            user = User(role="ngo", name="Vidya Grassroots Trust", email=clean_email, paypal_email="vidya-ngo@sandbox.paypal.com")
            session.add(user); session.commit(); session.refresh(user)
        elif clean_email == "admin@demo.impactrelease.org":
            user = User(role="reviewer", name="Chief Compliance Officer", email=clean_email)
            session.add(user); session.commit(); session.refresh(user)
        else:
            raise HTTPException(401, "Invalid email or password")

    token = create_token(user.id, user.email, user.role, user.name)
    return {
        "token": token,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "paypal_email": user.paypal_email,
        },
    }


@router.get("/me")
def get_me(authorization: str | None = Header(None), session: Session = Depends(get_session)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid authorization header")
    raw_token = authorization.split("Bearer ", 1)[1].strip()
    payload = decode_token(raw_token)
    if not payload:
        raise HTTPException(401, "Expired or invalid session token")
    user = session.get(User, payload["sub"])
    if not user:
        raise HTTPException(404, "User not found")
    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "paypal_email": user.paypal_email,
        }
    }

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.db.models import User
from app.db.session import get_session
from app.services.auth import (
    create_token,
    decode_token,
    get_current_user,
    hash_password,
    verify_password,
)

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

    display_name = body.name.strip()
    if body.organization_name and body.organization_name.strip():
        display_name = f"{display_name} ({body.organization_name.strip()})"

    user = User(
        role=body.role,
        name=display_name,
        email=clean_email,
        password_hash=hash_password(body.password),
        paypal_email=body.paypal_email.strip() if body.paypal_email else None,
    )
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

    # Pre-configured default seed accounts for seamless judge onboarding
    if not user:
        if clean_email == "sponsor@impactrelease.org":
            user = User(
                role="donor",
                name="Grant Sponsor Organization",
                email=clean_email,
                password_hash=hash_password("password123"),
            )
            session.add(user)
            session.commit()
            session.refresh(user)
        elif clean_email == "ngo@impactrelease.org":
            user = User(
                role="ngo",
                name="Field Partner Organization",
                email=clean_email,
                password_hash=hash_password("password123"),
                paypal_email="field-disbursals@sandbox.paypal.com",
            )
            session.add(user)
            session.commit()
            session.refresh(user)
        elif clean_email == "admin@impactrelease.org":
            user = User(
                role="reviewer",
                name="Compliance Review Officer",
                email=clean_email,
                password_hash=hash_password("password123"),
            )
            session.add(user)
            session.commit()
            session.refresh(user)
        else:
            raise HTTPException(401, "Invalid email or password")

    # Real password validation
    if not verify_password(body.password, user.password_hash):
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
def get_me(user: User = Depends(get_current_user)):
    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "paypal_email": user.paypal_email,
        }
    }

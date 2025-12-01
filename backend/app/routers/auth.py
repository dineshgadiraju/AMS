from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import (
    create_access_token,
    get_current_user,
    get_password_hash,
    verify_password,
)
from app.config import settings
from app.database import get_database
from app.models import Token, User, UserCreate, UserLogin
from app.utils.serialization import convert_object_ids


router = APIRouter()

@router.post("/register", response_model=dict)
async def register(user_data: UserCreate):
    db = get_database()
    
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    
    hashed_password = get_password_hash(user_data.password)
    
    if hasattr(user_data, 'model_dump'):
        user_dict = user_data.model_dump()
    else:
        user_dict = user_data.dict()
    
    user_dict["password"] = hashed_password
    user_dict["status"] = "active"
    
    result = await db.users.insert_one(user_dict)
    user_dict["_id"] = result.inserted_id
    user_dict.pop("password")
    
    return {"message": "User registered successfully", "user_id": str(result.inserted_id)}

@router.post("/login", response_model=Token)
async def login(credentials: UserLogin):
    db = get_database()
    
    user = await db.users.find_one({"email": credentials.email})
    if not user or not verify_password(credentials.password, user.get("password", "")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    
    if user.get("status") != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")
    
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(
        data={"sub": str(user["_id"])}, expires_delta=access_token_expires
    )
    
    user_data = {k: v for k, v in user.items() if k != "password"}
    user_data = convert_object_ids(user_data)
    
    if "_id" in user_data:
        user_data["id"] = user_data.get("id") or user_data["_id"]
    
    return {"access_token": access_token, "token_type": "bearer", "user": user_data}

@router.get("/me", response_model=dict)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    user_data = {k: v for k, v in current_user.items() if k != "password"}
    user_data = convert_object_ids(user_data)
    if "_id" in user_data:
        user_data["id"] = user_data.get("id") or user_data["_id"]
    return user_data
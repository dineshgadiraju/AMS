from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    mongodb_url: str = "mongodb://localhost:27017"
    database_name: str = "attendance_system"
    secret_key: str = "your-secret-key-here-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440
    face_images_count: int = 25
    upload_dir: str = "uploads"
    face_data_dir: str = "face_data"
    
    class Config:
        env_file = ".env"
        case_sensitive = False

settings = Settings()
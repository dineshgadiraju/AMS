from pydantic import BaseModel, EmailStr, Field, field_serializer, field_validator
from typing import Optional, List, Annotated
from datetime import datetime
from bson import ObjectId
from enum import Enum

def validate_object_id(v):
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, str):
        if ObjectId.is_valid(v):
            return v
        raise ValueError("Invalid ObjectId")
    raise ValueError("Invalid ObjectId")

class UserRole(str, Enum):
    ADMIN = "admin"
    FACULTY = "faculty"
    STUDENT = "student"

class UserStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"

class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    primary_mobile: str
    role: UserRole

class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    primary_mobile: str
    password: str
    role: Optional[UserRole] = None

class UserUpdate(BaseModel):
    secondary_mobile: Optional[str] = None
    address: Optional[str] = None

class User(UserBase):
    id: Optional[str] = Field(default=None, alias="_id")
    student_id: Optional[str] = None
    secondary_mobile: Optional[str] = None
    address: Optional[str] = None
    status: UserStatus = UserStatus.ACTIVE
    face_data_path: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "id": "string",
            }
        }

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: dict

class ClassBase(BaseModel):
    name: str
    code: str
    description: Optional[str] = None

class ClassCreate(ClassBase):
    faculty_id: str
    schedule: dict

class Class(ClassBase):
    id: Optional[str] = Field(default=None, alias="_id")
    faculty_id: str
    schedule: dict
    enrolled_students: List[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "id": "string",
            }
        }

class AttendanceMode(str, Enum):
    MANUAL = "manual"
    AUTO = "auto"

class AttendanceCreate(BaseModel):
    class_id: str
    date: datetime
    mode: AttendanceMode
    present_students: List[str] = []
    recognized_students: Optional[List[str]] = None
    total_faces_detected: Optional[int] = None
    total_faces_recognized: Optional[int] = None

class Attendance(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    class_id: str
    date: datetime
    mode: AttendanceMode
    present_students: List[str] = []
    recognized_students: Optional[List[str]] = None
    total_faces_detected: Optional[int] = None
    total_faces_recognized: Optional[int] = None
    created_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "id": "string",
            }
        }

class Enrollment(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    student_id: str
    class_id: str
    enrolled_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "id": "string",
            }
        }

class MessageCreate(BaseModel):
    recipient_id: str
    subject: str
    message: str
    thread_id: Optional[str] = None
    reply_to: Optional[str] = None

class Message(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    sender_id: str
    recipient_id: str
    subject: str
    message: str
    read: bool = False
    thread_id: Optional[str] = None
    reply_to: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "id": "string",
            }
        }

class AttendanceReport(BaseModel):
    student_id: str
    student_name: str
    total_classes: int
    present_count: int
    absent_count: int
    attendance_percentage: float

class ClassAttendanceReport(BaseModel):
    class_id: str
    class_name: str
    total_students: int
    attendance_records: List[AttendanceReport]
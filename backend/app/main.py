from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db
from app.routers import auth, admin, faculty, student
from app.config import settings

app = FastAPI(title="Attendance Management System", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database
@app.on_event("startup")
async def startup_event():
    await init_db()

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(faculty.router, prefix="/api/faculty", tags=["Faculty"])
app.include_router(student.router, prefix="/api/student", tags=["Student"])

@app.get("/")
async def root():
    return {"message": "Attendance Management System API"}

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/api/debug/websocket-test")
async def websocket_test():
    """Test endpoint to verify WebSocket support"""
    return {
        "message": "WebSocket endpoint available",
        "endpoint": "/api/faculty/attendance/auto/stream/{class_id}",
        "note": "Use ws://localhost:8888/api/faculty/attendance/auto/stream/{class_id} to connect"
    }
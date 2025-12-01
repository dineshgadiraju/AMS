from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings

client: AsyncIOMotorClient = None
database = None

async def init_db():
    global client, database
    client = AsyncIOMotorClient(settings.mongodb_url)
    database = client[settings.database_name]
    await database.users.create_index("email", unique=True)
    await database.users.create_index("student_id", unique=True, sparse=True)
    await database.classes.create_index("code", unique=True)
    await database.attendance.create_index([("class_id", 1), ("date", 1)])
    await database.face_images.create_index("student_id", unique=True)
    
async def close_db():
    global client
    if client:
        client.close()

def get_database():
    return database
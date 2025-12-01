from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from fastapi.responses import Response
from typing import List, Optional
from datetime import datetime, timedelta
import os
import uuid
import csv
import logging
from io import StringIO
from app.models import (
    UserCreate, User, UserUpdate, ClassCreate, Class,
    AttendanceReport, ClassAttendanceReport
)
from app.auth import get_current_admin, get_password_hash
from app.database import get_database
from app.config import settings
from app.services.face_recognition import face_recognition_service
from app.utils.serialization import convert_object_ids
from bson import ObjectId
import aiofiles

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/students", response_model=dict)
async def add_student(student_data: UserCreate, current_user: dict = Depends(get_current_admin)):

    db = get_database()
    
    existing = await db.users.find_one({"email": student_data.email})
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")
    
    student_id = f"STU{datetime.now().strftime('%Y%m%d')}{uuid.uuid4().hex[:6].upper()}"
    
    hashed_password = get_password_hash(student_data.password)
    
    if hasattr(student_data, 'model_dump'):
        student_dict = student_data.model_dump()
    else:
        student_dict = student_data.dict()
    
    student_dict["password"] = hashed_password
    student_dict["student_id"] = student_id
    student_dict["role"] = "student"
    student_dict["status"] = "active"
    
    result = await db.users.insert_one(student_dict)
    
    return {"message": "Student added successfully", "student_id": student_id, "user_id": str(result.inserted_id)}

@router.post("/students/{student_id}/face-data")
async def upload_face_data(student_id: str, images: List[UploadFile] = File(...), current_user: dict = Depends(get_current_admin)):
    import base64
    
    db = get_database()
    
    student = await db.users.find_one({"student_id": student_id})
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    
    if len(images) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one image is required")
    
    base64_images = []
    encodings = []
    
    for i, image in enumerate(images):
        content = await image.read()
        
        base64_str = base64.b64encode(content).decode('utf-8')
        base64_images.append(base64_str)
        
        encoding = face_recognition_service.encode_face_from_bytes(content)
        if encoding is not None:
            encodings.append(encoding)
    
    if len(encodings) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No faces detected in any of the images")
    
    face_data_path = face_recognition_service.save_face_encodings(student_id, encodings)
    
    await db.face_images.update_one(
        {"student_id": student_id},
        {
            "$set": {
                "student_id": student_id,
                "images": base64_images,
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow()
            }
        },
        upsert=True
    )
    
    await db.users.update_one(
        {"student_id": student_id},
        {"$set": {
            "face_data_path": face_data_path,
            "has_face_data": True,
            "face_data_updated_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }}
    )
    
    return {
        "message": "Face data uploaded and trained successfully",
        "images_processed": len(encodings),
        "total_images": len(images),
        "faces_detected": len(encodings)
    }

@router.get("/students", response_model=List[dict])
async def get_students(current_user: dict = Depends(get_current_admin)):
    db = get_database()
    students = await db.users.find({"role": "student"}).to_list(length=1000)
    serialized = []
    for student in students:
        student_data = {k: v for k, v in student.items() if k != "password"}
        student_data = convert_object_ids(student_data)
        if "_id" in student_data:
            student_data["id"] = student_data.get("id") or student_data["_id"]
        serialized.append(student_data)
    return serialized

@router.get("/students/{student_id}/face-images", response_model=dict)
async def get_face_images(student_id: str, current_user: dict = Depends(get_current_admin)):
    db = get_database()
    
    face_data = await db.face_images.find_one({"student_id": student_id})
    if not face_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No face images found for this student")
    
    return {
        "student_id": student_id,
        "images": face_data.get("images", []),
        "created_at": face_data.get("created_at"),
        "updated_at": face_data.get("updated_at")
    }

@router.put("/students/{student_id}/status")
async def toggle_student_status(
    student_id: str,
    new_status: str = Query(..., description="New status: 'active' or 'disabled'"),
    current_user: dict = Depends(get_current_admin)):

    db = get_database()
    
    if new_status not in ["active", "disabled"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status")
    
    result = await db.users.update_one(
        {"student_id": student_id},
        {"$set": {"status": new_status, "updated_at": datetime.utcnow()}},
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    
    return {"message": f"Student status updated to {new_status}"}

@router.delete("/students/{student_id}")
async def delete_student(student_id: str, current_user: dict = Depends(get_current_admin)):

    db = get_database()
    
    student = await db.users.find_one({"student_id": student_id, "role": "student"})
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    
    await db.users.delete_one({"student_id": student_id, "role": "student"})
    
    face_data_path = student.get("face_data_path")
    if face_data_path and os.path.exists(face_data_path):
        try:
            os.remove(face_data_path)
        except Exception as e:
            logger.error(f"Error deleting face data file: {e}")
    
    await db.face_images.delete_one({"student_id": student_id})
    
    await db.classes.update_many(
        {"enrolled_students": student_id},
        {"$pull": {"enrolled_students": student_id}}
    )
    
    return {"message": "Student deleted successfully"}

@router.post("/faculties", response_model=dict)
async def add_faculty(faculty_data: UserCreate, current_user: dict = Depends(get_current_admin)):

    db = get_database()
    
    existing = await db.users.find_one({"email": faculty_data.email})
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")
    
    hashed_password = get_password_hash(faculty_data.password)
    if hasattr(faculty_data, 'model_dump'):
        faculty_dict = faculty_data.model_dump()
    else:
        faculty_dict = faculty_data.dict()
    
    faculty_dict["password"] = hashed_password
    faculty_dict["role"] = "faculty"
    faculty_dict["status"] = "active"
    
    result = await db.users.insert_one(faculty_dict)
    
    return {"message": "Faculty added successfully", "user_id": str(result.inserted_id)}

@router.get("/faculties", response_model=List[dict])
async def get_faculties(current_user: dict = Depends(get_current_admin)):

    db = get_database()
    faculties = await db.users.find({"role": "faculty"}).to_list(length=1000)
    serialized = []
    for faculty in faculties:
        faculty_data = {k: v for k, v in faculty.items() if k != "password"}
        faculty_data = convert_object_ids(faculty_data)
        if "_id" in faculty_data:
            faculty_data["id"] = faculty_data.get("id") or faculty_data["_id"]
        serialized.append(faculty_data)
    return serialized

@router.delete("/faculties/{faculty_id}")
async def delete_faculty(faculty_id: str, current_user: dict = Depends(get_current_admin)):

    db = get_database()
    
    try:
        faculty_obj_id = ObjectId(faculty_id)
    except:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid faculty ID")
    
    faculty = await db.users.find_one({"_id": faculty_obj_id, "role": "faculty"})
    if not faculty:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Faculty not found")
    
    classes_count = await db.classes.count_documents({"faculty_id": faculty_id})
    if classes_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete faculty. They are assigned to {classes_count} class(es). Please reassign classes first."
        )
    
    await db.users.delete_one({"_id": faculty_obj_id, "role": "faculty"})
    
    return {"message": "Faculty deleted successfully"}

@router.post("/classes", response_model=dict)
async def create_class(class_data: ClassCreate, current_user: dict = Depends(get_current_admin)):

    db = get_database()
    
    existing = await db.classes.find_one({"code": class_data.code})
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Class code already exists")
    
    faculty = await db.users.find_one({"_id": ObjectId(class_data.faculty_id), "role": "faculty"})
    if not faculty:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Faculty not found")
    
    if hasattr(class_data, 'model_dump'):
        class_dict = class_data.model_dump()
    else:
        class_dict = class_data.dict()
    
    result = await db.classes.insert_one(class_dict)
    
    return {"message": "Class created successfully", "class_id": str(result.inserted_id)}

@router.get("/classes", response_model=List[dict])
async def get_classes(current_user: dict = Depends(get_current_admin)):

    db = get_database()
    classes = await db.classes.find().to_list(length=1000)
    
    result = []
    for cls in classes:
        faculty = await db.users.find_one({"_id": ObjectId(cls["faculty_id"])})
        cls_dict = convert_object_ids(cls)
        if "_id" in cls_dict:
            cls_dict["id"] = cls_dict.get("id") or cls_dict["_id"]
        cls_dict["faculty_name"] = faculty.get("full_name") if faculty else "Unknown"
        result.append(cls_dict)
    
    return result

@router.put("/classes/{class_id}", response_model=dict)
async def update_class(
    class_id: str,
    class_data: ClassCreate,
    current_user: dict = Depends(get_current_admin)
):
    db = get_database()
    
    try:
        class_obj_id = ObjectId(class_id)
    except:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid class ID")
    
    # Check if class exists
    existing_class = await db.classes.find_one({"_id": class_obj_id})
    if not existing_class:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")
    
    # Check if code is being changed and if new code already exists
    if class_data.code != existing_class.get("code"):
        code_exists = await db.classes.find_one({"code": class_data.code, "_id": {"$ne": class_obj_id}})
        if code_exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Class code already exists"
            )
    
    # Verify faculty exists
    faculty = await db.users.find_one({"_id": ObjectId(class_data.faculty_id), "role": "faculty"})
    if not faculty:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Faculty not found")
    
    # Prepare update data
    if hasattr(class_data, 'model_dump'):
        update_dict = class_data.model_dump()
    else:
        update_dict = class_data.dict()
    
    # Preserve enrolled_students and created_at
    update_dict["enrolled_students"] = existing_class.get("enrolled_students", [])
    
    # Update class
    await db.classes.update_one(
        {"_id": class_obj_id},
        {"$set": update_dict}
    )
    
    return {"message": "Class updated successfully"}

@router.delete("/classes/{class_id}", response_model=dict)
async def delete_class(class_id: str, current_user: dict = Depends(get_current_admin)):
    db = get_database()
    
    try:
        class_obj_id = ObjectId(class_id)
    except:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid class ID")
    
    # Check if class exists
    cls = await db.classes.find_one({"_id": class_obj_id})
    if not cls:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")
    
    # Check for enrolled students
    enrolled_students = cls.get("enrolled_students", [])
    if enrolled_students:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete class. {len(enrolled_students)} student(s) are enrolled. Please remove all students first."
        )
    
    # Check for attendance records
    attendance_count = await db.attendance.count_documents({"class_id": class_id})
    if attendance_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete class. {attendance_count} attendance record(s) exist. Please delete attendance records first."
        )
    
    # Delete class
    await db.classes.delete_one({"_id": class_obj_id})
    
    return {"message": "Class deleted successfully"}

@router.get("/reports/attendance", response_model=List[ClassAttendanceReport])
async def get_attendance_reports(class_id: Optional[str] = None, start_date: Optional[datetime] = None, end_date: Optional[datetime] = None, current_user: dict = Depends(get_current_admin)):
    db = get_database()
    
    query = {}
    if class_id:
        query["class_id"] = class_id
    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = start_date
        if end_date:
            query["date"]["$lte"] = end_date
    
    if class_id:
        classes = [await db.classes.find_one({"_id": ObjectId(class_id)})]
    else:
        classes = await db.classes.find().to_list(length=1000)
    
    reports = []
    for cls in classes:
        if not cls:
            continue
        
        enrolled_students = cls.get("enrolled_students", [])
        attendance_records = []
        
        for student_id in enrolled_students:
            student = await db.users.find_one({"student_id": student_id})
            if not student:
                continue
            
            class_query = {"class_id": str(cls["_id"]), "present_students": student_id}
            if start_date or end_date:
                class_query["date"] = query.get("date", {})
            
            total_classes = await db.attendance.count_documents({"class_id": str(cls["_id"])})
            present_count = await db.attendance.count_documents(class_query)
            absent_count = total_classes - present_count
            
            attendance_percentage = (present_count / total_classes * 100) if total_classes > 0 else 0
            
            attendance_records.append(AttendanceReport(
                student_id=student_id,
                student_name=student.get("full_name"),
                total_classes=total_classes,
                present_count=present_count,
                absent_count=absent_count,
                attendance_percentage=round(attendance_percentage, 2)
            ))
        
        reports.append(ClassAttendanceReport(
            class_id=str(cls["_id"]),
            class_name=cls.get("name"),
            total_students=len(enrolled_students),
            attendance_records=attendance_records
        ))
    
    return reports

@router.get("/reports/download")
async def download_report(
    report_type: str,
    class_id: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    format: str = "csv",
    current_user: dict = Depends(get_current_admin)
):
    db = get_database()
    
    if class_id:
        classes = [await db.classes.find_one({"_id": ObjectId(class_id)})]
    else:
        classes = await db.classes.find().to_list(length=1000)
    
    date_query = {}
    if start_date or end_date:
        date_query = {}
        if start_date:
            date_query["$gte"] = start_date
        if end_date:
            date_query["$lte"] = end_date
    
    output = StringIO()
    writer = csv.writer(output)
    
    writer.writerow(["Class Name", "Student ID", "Student Name", "Total Classes", "Present", "Absent", "Attendance Percentage"])
    
    for cls in classes:
        if not cls:
            continue
        class_name = cls.get("name", "Unknown")
        enrolled_students = cls.get("enrolled_students", [])
        
        for student_id in enrolled_students:
            student = await db.users.find_one({"student_id": student_id})
            if not student:
                continue
            
            total_query = {"class_id": str(cls["_id"])}
            present_query = {
                "class_id": str(cls["_id"]),
                "present_students": student_id
            }
            
            if date_query:
                total_query["date"] = date_query
                present_query["date"] = date_query
            
            total_classes = await db.attendance.count_documents(total_query)
            present_count = await db.attendance.count_documents(present_query)
            absent_count = total_classes - present_count
            attendance_percentage = (present_count / total_classes * 100) if total_classes > 0 else 0
            
            writer.writerow([
                class_name,
                student_id,
                student.get("full_name", "Unknown"),
                total_classes,
                present_count,
                absent_count,
                f"{round(attendance_percentage, 2)}%"
            ])
    
    date_suffix = ""
    if start_date or end_date:
        start_str = start_date.strftime("%Y%m%d") if start_date else ""
        end_str = end_date.strftime("%Y%m%d") if end_date else ""
        date_suffix = f"_{start_str}_to_{end_str}" if start_str and end_str else f"_{start_str}" if start_str else f"_{end_str}"
    
    filename = f"attendance_report_{class_id if class_id else 'all_classes'}{date_suffix}.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )

@router.put("/settings/face-images-count")
async def update_face_images_count(
    count: int,
    current_user: dict = Depends(get_current_admin)
):
    if count < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Count must be at least 1"
        )
    
    settings.face_images_count = count
    
    return {"message": f"Face images count updated to {count}", "count": count}

@router.get("/stats", response_model=dict)
async def get_dashboard_stats(start_date: Optional[datetime] = None, end_date: Optional[datetime] = None, current_user: dict = Depends(get_current_admin)):
    
    db = get_database()
    
    date_query = {}
    if start_date or end_date:
        if start_date:
            date_query["$gte"] = start_date
        if end_date:
            date_query["$lte"] = end_date
    
    total_students = await db.users.count_documents({"role": "student"})
    total_faculties = await db.users.count_documents({"role": "faculty"})
    total_classes = await db.classes.count_documents({})
    
    total_attendance_query = {}
    if date_query:
        total_attendance_query["date"] = date_query
    total_attendance = await db.attendance.count_documents(total_attendance_query)
    
    active_students = await db.users.count_documents({"role": "student", "status": "active"})
    
    if start_date and end_date:
        attendance_last_7_days = total_attendance
    else:
        seven_days_ago = datetime.utcnow() - timedelta(days=7)
        attendance_last_7_days = await db.attendance.count_documents({"date": {"$gte": seven_days_ago}})
    
    attendance_by_day = []
    if start_date and end_date:
        current_date = start_date
        while current_date <= end_date:
            day_start = current_date.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = current_date.replace(hour=23, minute=59, second=59, microsecond=999999)
            count = await db.attendance.count_documents({
                "date": {"$gte": day_start, "$lte": day_end}
            })
            attendance_by_day.append({
                "date": current_date.strftime("%Y-%m-%d"),
                "day": current_date.strftime("%a"),
                "count": count
            })
            current_date += timedelta(days=1)
    else:
        for i in range(6, -1, -1):
            day = datetime.utcnow() - timedelta(days=i)
            day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day.replace(hour=23, minute=59, second=59, microsecond=999999)
            count = await db.attendance.count_documents({
                "date": {"$gte": day_start, "$lte": day_end}
            })
            attendance_by_day.append({
                "date": day.strftime("%Y-%m-%d"),
                "day": day.strftime("%a"),
                "count": count
            })
    
    classes = await db.classes.find().to_list(length=1000)
    class_enrollments = []
    for cls in classes:
        enrolled_count = len(cls.get("enrolled_students", []))
        class_enrollments.append({
            "class_name": cls.get("name", "Unknown"),
            "students": enrolled_count
        })
    class_enrollments.sort(key=lambda x: x["students"], reverse=True)
    top_classes = class_enrollments[:5]
    
    attendance_by_class = []
    for cls in classes[:10]:
        attendance_query = {"class_id": str(cls["_id"])}
        if date_query:
            attendance_query["date"] = date_query
        attendance_count = await db.attendance.count_documents(attendance_query)
        attendance_by_class.append({
            "class_name": cls.get("name", "Unknown"),
            "attendance_count": attendance_count
        })
    attendance_by_class.sort(key=lambda x: x["attendance_count"], reverse=True)
    
    return {
        "total_students": total_students,
        "active_students": active_students,
        "total_faculties": total_faculties,
        "total_classes": total_classes,
        "total_attendance": total_attendance,
        "attendance_last_7_days": attendance_last_7_days,
        "attendance_by_day": attendance_by_day,
        "top_classes": top_classes,
        "attendance_by_class": attendance_by_class[:5]
    }
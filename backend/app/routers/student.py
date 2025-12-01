from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from typing import List, Optional
from datetime import datetime, timedelta
import qrcode
import io
import base64
import csv
import uuid
import logging
from app.models import UserUpdate, Enrollment, MessageCreate, Message
from app.auth import get_current_student, get_websocket_user
from app.database import get_database
from app.utils.serialization import convert_object_ids
from app.utils.websocket_manager import connection_manager
from bson import ObjectId

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/profile", response_model=dict)
async def get_profile(current_user: dict = Depends(get_current_student)):
    user_data = {k: v for k, v in current_user.items() if k != "password"}
    user_data = convert_object_ids(user_data)
    if "_id" in user_data:
        user_data["id"] = user_data.get("id") or user_data["_id"]
    return user_data

@router.put("/profile", response_model=dict)
async def update_profile(
    profile_data: UserUpdate,
    current_user: dict = Depends(get_current_student)
):
    db = get_database()
    
    # Use model_dump for Pydantic v2, fallback to dict for v1
    if hasattr(profile_data, 'model_dump'):
        update_dict = profile_data.model_dump(exclude_unset=True)
    else:
        update_dict = profile_data.dict(exclude_unset=True)
    
    update_dict["updated_at"] = datetime.utcnow()
    
    await db.users.update_one(
        {"_id": current_user["_id"]},
        {"$set": update_dict}
    )
    
    updated_user = await db.users.find_one({"_id": current_user["_id"]})
    user_data = {k: v for k, v in updated_user.items() if k != "password"}
    user_data = convert_object_ids(user_data)
    if "_id" in user_data:
        user_data["id"] = user_data.get("id") or user_data["_id"]
    
    return {"message": "Profile updated successfully", "user": user_data}

@router.get("/classes/available", response_model=List[dict])
async def get_available_classes(current_user: dict = Depends(get_current_student)):
    db = get_database()
    classes = await db.classes.find().to_list(length=1000)
    
    result = []
    for cls in classes:
        # Check if already enrolled
        is_enrolled = current_user.get("student_id") in cls.get("enrolled_students", [])
        
        # Get faculty info
        faculty = await db.users.find_one({"_id": ObjectId(cls.get("faculty_id"))})
        
        cls_dict = {
            "id": str(cls["_id"]),
            "name": cls.get("name"),
            "code": cls.get("code"),
            "description": cls.get("description"),
            "schedule": cls.get("schedule"),
            "faculty_name": faculty.get("full_name") if faculty else "Unknown",
            "is_enrolled": is_enrolled
        }
        result.append(cls_dict)
    
    return result

@router.post("/classes/{class_id}/enroll", response_model=dict)
async def enroll_in_class(
    class_id: str,
    current_user: dict = Depends(get_current_student)
):
    db = get_database()
    
    # Verify class exists
    cls = await db.classes.find_one({"_id": ObjectId(class_id)})
    if not cls:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Class not found"
        )
    
    student_id = current_user.get("student_id")
    if not student_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student ID not found"
        )
    
    # Check if already enrolled
    if student_id in cls.get("enrolled_students", []):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already enrolled in this class"
        )
    
    # Add student to class
    await db.classes.update_one(
        {"_id": ObjectId(class_id)},
        {"$push": {"enrolled_students": student_id}}
    )
    
    # Create enrollment record
    enrollment = {
        "student_id": student_id,
        "class_id": class_id,
        "enrolled_at": datetime.utcnow()
    }
    await db.enrollments.insert_one(enrollment)
    
    return {"message": "Enrolled successfully"}

@router.get("/classes/enrolled", response_model=List[dict])
async def get_enrolled_classes(current_user: dict = Depends(get_current_student)):
    db = get_database()
    
    student_id = current_user.get("student_id")
    if not student_id:
        return []
    
    classes = await db.classes.find({"enrolled_students": student_id}).to_list(length=1000)
    
    result = []
    for cls in classes:
        # Get attendance stats
        total_classes = await db.attendance.count_documents({"class_id": str(cls["_id"])})
        present_count = await db.attendance.count_documents({
            "class_id": str(cls["_id"]),
            "present_students": student_id
        })
        attendance_percentage = (present_count / total_classes * 100) if total_classes > 0 else 0
        
        # Get faculty info
        faculty = await db.users.find_one({"_id": ObjectId(cls.get("faculty_id"))})
        
        cls_dict = {
            "id": str(cls["_id"]),
            "name": cls.get("name"),
            "code": cls.get("code"),
            "description": cls.get("description"),
            "schedule": cls.get("schedule"),
            "faculty_name": faculty.get("full_name") if faculty else "Unknown",
            "total_classes": total_classes,
            "present_count": present_count,
            "attendance_percentage": round(attendance_percentage, 2)
        }
        result.append(cls_dict)
    
    return result

@router.get("/attendance/reports", response_model=List[dict])
async def get_attendance_reports(
    class_id: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: dict = Depends(get_current_student)
):
    db = get_database()
    
    student_id = current_user.get("student_id")
    if not student_id:
        return []
    
    query = {"present_students": student_id}
    if class_id:
        query["class_id"] = class_id
    else:
        # Get all enrolled classes
        classes = await db.classes.find({"enrolled_students": student_id}).to_list(length=1000)
        class_ids = [str(cls["_id"]) for cls in classes]
        query["class_id"] = {"$in": class_ids}
    
    # Add date filters
    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = start_date
        if end_date:
            query["date"]["$lte"] = end_date
    
    attendance_records = await db.attendance.find(query).sort("date", -1).to_list(length=1000)
    
    result = []
    for record in attendance_records:
        cls = await db.classes.find_one({"_id": ObjectId(record["class_id"])})
        record_dict = {
            "id": str(record["_id"]),
            "class_id": record["class_id"],
            "class_name": cls.get("name") if cls else "Unknown",
            "date": record["date"],
            "timestamp": record.get("created_at", record.get("date")),
            "mode": record.get("mode", "manual"),
            "status": "present"
        }
        result.append(record_dict)
    
    return result

@router.get("/stats", response_model=dict)
async def get_student_stats(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: dict = Depends(get_current_student)
):
    db = get_database()
    
    student_id = current_user.get("student_id")
    if not student_id:
        return {
            "total_classes": 0,
            "total_attendance": 0,
            "attendance_percentage": 0,
            "attendance_by_class": [],
            "attendance_by_day": [],
            "recent_attendance": []
        }
    
    # Build date filter query
    date_query = {}
    if start_date or end_date:
        if start_date:
            date_query["$gte"] = start_date
        if end_date:
            date_query["$lte"] = end_date
    
    # Get enrolled classes
    classes = await db.classes.find({"enrolled_students": student_id}).to_list(length=1000)
    total_classes_count = len(classes)
    
    # Get total attendance
    class_ids = [str(cls["_id"]) for cls in classes]
    total_attendance_query = {
        "class_id": {"$in": class_ids},
        "present_students": student_id
    }
    if date_query:
        total_attendance_query["date"] = date_query
    
    total_attendance = await db.attendance.count_documents(total_attendance_query)
    
    # Calculate overall attendance percentage
    total_possible_query = {"class_id": {"$in": class_ids}}
    if date_query:
        total_possible_query["date"] = date_query
    total_possible_attendance = await db.attendance.count_documents(total_possible_query)
    overall_percentage = (total_attendance / total_possible_attendance * 100) if total_possible_attendance > 0 else 0
    
    # Get attendance by class
    attendance_by_class = []
    for cls in classes:
        class_total_query = {"class_id": str(cls["_id"])}
        class_present_query = {
            "class_id": str(cls["_id"]),
            "present_students": student_id
        }
        if date_query:
            class_total_query["date"] = date_query
            class_present_query["date"] = date_query
        
        class_total = await db.attendance.count_documents(class_total_query)
        class_present = await db.attendance.count_documents(class_present_query)
        class_percentage = (class_present / class_total * 100) if class_total > 0 else 0
        
        attendance_by_class.append({
            "class_name": cls.get("name", "Unknown"),
            "total_classes": class_total,
            "present_count": class_present,
            "attendance_percentage": round(class_percentage, 2)
        })
    
    # Get attendance by day - use date range if provided, otherwise last 7 days
    attendance_by_day = []
    if start_date and end_date:
        # Use provided date range
        current_date = start_date
        while current_date <= end_date:
            day_start = current_date.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = current_date.replace(hour=23, minute=59, second=59, microsecond=999999)
            count = await db.attendance.count_documents({
                "class_id": {"$in": class_ids},
                "present_students": student_id,
                "date": {"$gte": day_start, "$lte": day_end}
            })
            attendance_by_day.append({
                "date": current_date.strftime("%Y-%m-%d"),
                "day": current_date.strftime("%a"),
                "count": count
            })
            current_date += timedelta(days=1)
    else:
        # Default to last 7 days
        for i in range(6, -1, -1):
            day = datetime.utcnow() - timedelta(days=i)
            day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day.replace(hour=23, minute=59, second=59, microsecond=999999)
            count = await db.attendance.count_documents({
                "class_id": {"$in": class_ids},
                "present_students": student_id,
                "date": {"$gte": day_start, "$lte": day_end}
            })
            attendance_by_day.append({
                "date": day.strftime("%Y-%m-%d"),
                "day": day.strftime("%a"),
                "count": count
            })
    
    # Get recent attendance (last 10)
    recent_query = {
        "class_id": {"$in": class_ids},
        "present_students": student_id
    }
    if date_query:
        recent_query["date"] = date_query
    recent_records = await db.attendance.find(recent_query).sort("date", -1).limit(10).to_list(length=10)
    
    recent_attendance = []
    for record in recent_records:
        cls = await db.classes.find_one({"_id": ObjectId(record["class_id"])})
        recent_attendance.append({
            "class_name": cls.get("name") if cls else "Unknown",
            "date": record["date"],
            "mode": record.get("mode", "manual")
        })
    
    return {
        "total_classes": total_classes_count,
        "total_attendance": total_attendance,
        "total_possible_attendance": total_possible_attendance,
        "attendance_percentage": round(overall_percentage, 2),
        "attendance_by_class": attendance_by_class,
        "attendance_by_day": attendance_by_day,
        "recent_attendance": recent_attendance
    }

@router.get("/attendance/reports/download")
async def download_attendance_report(
    class_id: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    format: str = "excel",
    current_user: dict = Depends(get_current_student)
):
    db = get_database()
    
    student_id = current_user.get("student_id")
    if not student_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student ID not found"
        )
    
    query = {"present_students": student_id}
    if class_id:
        query["class_id"] = class_id
    else:
        classes = await db.classes.find({"enrolled_students": student_id}).to_list(length=1000)
        class_ids = [str(cls["_id"]) for cls in classes]
        query["class_id"] = {"$in": class_ids}
    
    # Add date filters
    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = start_date
        if end_date:
            query["date"]["$lte"] = end_date
    
    attendance_records = await db.attendance.find(query).sort("date", -1).to_list(length=1000)
    
    # Generate CSV content
    from io import StringIO
    
    output = StringIO()
    writer = csv.writer(output)
    
    # Write header
    writer.writerow(["Date", "Time", "Class Name", "Mode", "Status"])
    
    # Write data
    for record in attendance_records:
        cls = await db.classes.find_one({"_id": ObjectId(record["class_id"])})
        class_name = cls.get("name") if cls else "Unknown"
        date_obj = record.get("date") or record.get("created_at")
        if isinstance(date_obj, str):
            date_obj = datetime.fromisoformat(date_obj.replace('Z', '+00:00'))
        date_str = date_obj.strftime("%Y-%m-%d") if isinstance(date_obj, datetime) else str(date_obj)
        time_str = date_obj.strftime("%H:%M:%S") if isinstance(date_obj, datetime) else ""
        writer.writerow([
            date_str,
            time_str,
            class_name,
            record.get("mode", "manual"),
            "Present"
        ])
    
    # Build filename with date range if provided
    date_suffix = ""
    if start_date or end_date:
        start_str = start_date.strftime("%Y%m%d") if start_date else ""
        end_str = end_date.strftime("%Y%m%d") if end_date else ""
        date_suffix = f"_{start_str}_to_{end_str}" if start_str and end_str else f"_{start_str}" if start_str else f"_{end_str}"
    
    filename = f"attendance_report_{student_id}{date_suffix}.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )

@router.get("/enrollment/history", response_model=List[dict])
async def get_enrollment_history(current_user: dict = Depends(get_current_student)):
    db = get_database()
    
    student_id = current_user.get("student_id")
    if not student_id:
        return []
    
    enrollments = await db.enrollments.find({"student_id": student_id}).sort("enrolled_at", -1).to_list(length=1000)
    
    result = []
    for enrollment in enrollments:
        cls = await db.classes.find_one({"_id": ObjectId(enrollment["class_id"])})
        if cls:
            result.append({
                "id": str(enrollment["_id"]),
                "class_id": enrollment["class_id"],
                "class_name": cls.get("name"),
                "class_code": cls.get("code"),
                "enrolled_at": enrollment["enrolled_at"]
            })
    
    return result

@router.post("/messages/send", response_model=dict)
async def send_message(
    message_data: MessageCreate,
    current_user: dict = Depends(get_current_student)
):
    db = get_database()
    
    # Verify recipient exists
    recipient = await db.users.find_one({"_id": ObjectId(message_data.recipient_id)})
    if not recipient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recipient not found"
        )
    
    # Generate thread_id if it's a new thread, otherwise use provided thread_id
    thread_id = message_data.thread_id
    if not thread_id:
        thread_id = str(uuid.uuid4())
    
    # Create message
    message_dict = {
        "sender_id": str(current_user["_id"]),
        "recipient_id": message_data.recipient_id,
        "subject": message_data.subject,
        "message": message_data.message,
        "thread_id": thread_id,
        "reply_to": message_data.reply_to,
        "read": False,
        "created_at": datetime.utcnow()
    }
    
    result = await db.messages.insert_one(message_dict)
    message_id = str(result.inserted_id)
    
    # Get sender info for notification
    sender = await db.users.find_one({"_id": ObjectId(current_user["_id"])})
    
    # Send real-time notification via WebSocket
    notification_data = {
        "type": "new_message",
        "message_id": message_id,
        "thread_id": thread_id,
        "sender_id": str(current_user["_id"]),
        "sender_name": sender.get("full_name") if sender else "Unknown",
        "subject": message_data.subject,
        "message": message_data.message,
        "created_at": message_dict["created_at"].isoformat()
    }
    
    await connection_manager.send_personal_message(notification_data, message_data.recipient_id)
    
    return {
        "message": "Message sent successfully",
        "message_id": message_id,
        "thread_id": thread_id
    }

@router.post("/messages/reply", response_model=dict)
async def reply_to_message(
    message_data: MessageCreate,
    current_user: dict = Depends(get_current_student)
):
    """Reply to an existing message thread"""
    db = get_database()
    
    if not message_data.thread_id or not message_data.reply_to:
        raise HTTPException(status_code=400, detail="thread_id and reply_to are required for replies")
    
    # Verify original message exists
    original_message = await db.messages.find_one({"_id": ObjectId(message_data.reply_to)})
    if not original_message:
        raise HTTPException(status_code=404, detail="Original message not found")
    
    # Determine recipient (opposite of sender)
    if original_message["sender_id"] == str(current_user["_id"]):
        recipient_id = original_message["recipient_id"]
    else:
        recipient_id = original_message["sender_id"]
    
    # Verify recipient exists
    recipient = await db.users.find_one({"_id": ObjectId(recipient_id)})
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
    # Create reply message
    message_dict = {
        "sender_id": str(current_user["_id"]),
        "recipient_id": recipient_id,
        "subject": f"Re: {original_message.get('subject', 'Message')}",
        "message": message_data.message,
        "thread_id": message_data.thread_id,
        "reply_to": message_data.reply_to,
        "read": False,
        "created_at": datetime.utcnow()
    }
    
    result = await db.messages.insert_one(message_dict)
    message_id = str(result.inserted_id)
    
    # Get sender info for notification
    sender = await db.users.find_one({"_id": ObjectId(current_user["_id"])})
    
    # Send real-time notification via WebSocket
    notification_data = {
        "type": "new_message",
        "message_id": message_id,
        "thread_id": message_data.thread_id,
        "sender_id": str(current_user["_id"]),
        "sender_name": sender.get("full_name") if sender else "Unknown",
        "subject": message_dict["subject"],
        "message": message_data.message,
        "created_at": message_dict["created_at"].isoformat()
    }
    
    await connection_manager.send_personal_message(notification_data, recipient_id)
    
    return {
        "message": "Reply sent successfully",
        "message_id": message_id,
        "thread_id": message_data.thread_id
    }

@router.get("/messages", response_model=List[dict])
async def get_messages(
    unread_only: bool = False,
    thread_id: Optional[str] = None,
    current_user: dict = Depends(get_current_student)
):
    db = get_database()
    
    # Build query - get messages where user is recipient or sender (for thread view)
    if thread_id:
        query = {"thread_id": thread_id}
    else:
        query = {"recipient_id": str(current_user["_id"])}
    
    if unread_only:
        query["read"] = False
    
    messages = await db.messages.find(query).sort("created_at", 1).to_list(length=1000)
    
    result = []
    for msg in messages:
        sender = await db.users.find_one({"_id": ObjectId(msg["sender_id"])})
        recipient = await db.users.find_one({"_id": ObjectId(msg["recipient_id"])})
        msg_dict = {
            "id": str(msg["_id"]),
            "sender_id": msg["sender_id"],
            "sender_name": sender.get("full_name") if sender else "Unknown",
            "recipient_id": msg["recipient_id"],
            "recipient_name": recipient.get("full_name") if recipient else "Unknown",
            "subject": msg.get("subject"),
            "message": msg.get("message"),
            "thread_id": msg.get("thread_id"),
            "reply_to": msg.get("reply_to"),
            "read": msg.get("read", False),
            "created_at": msg.get("created_at")
        }
        result.append(msg_dict)
    
    return result

@router.get("/messages/threads", response_model=List[dict])
async def get_message_threads(current_user: dict = Depends(get_current_student)):
    """Get all message threads for the current user"""
    db = get_database()
    
    # Get all messages where user is recipient or sender
    messages = await db.messages.find({
        "$or": [
            {"recipient_id": str(current_user["_id"])},
            {"sender_id": str(current_user["_id"])}
        ]
    }).sort("created_at", -1).to_list(length=1000)
    
    # Group by thread_id
    threads = {}
    for msg in messages:
        thread_id = msg.get("thread_id")
        if not thread_id:
            thread_id = str(msg["_id"])
        
        if thread_id not in threads:
            threads[thread_id] = {
                "thread_id": thread_id,
                "subject": msg.get("subject", "No Subject"),
                "last_message": msg.get("message", ""),
                "last_message_time": msg.get("created_at"),
                "unread_count": 0,
                "participants": set(),
                "messages": []
            }
        
        threads[thread_id]["messages"].append(msg)
        threads[thread_id]["participants"].add(msg["sender_id"])
        threads[thread_id]["participants"].add(msg["recipient_id"])
        
        # Count unread messages
        if msg.get("recipient_id") == str(current_user["_id"]) and not msg.get("read", False):
            threads[thread_id]["unread_count"] += 1
    
    # Convert to list and get participant names
    result = []
    for thread_id, thread_data in threads.items():
        # Get participant names
        participants = []
        for participant_id in thread_data["participants"]:
            if participant_id != str(current_user["_id"]):
                participant = await db.users.find_one({"_id": ObjectId(participant_id)})
                if participant:
                    participants.append({
                        "id": participant_id,
                        "name": participant.get("full_name", "Unknown")
                    })
        
        result.append({
            "thread_id": thread_id,
            "subject": thread_data["subject"],
            "last_message": thread_data["last_message"][:100] + "..." if len(thread_data["last_message"]) > 100 else thread_data["last_message"],
            "last_message_time": thread_data["last_message_time"],
            "unread_count": thread_data["unread_count"],
            "participants": participants,
            "message_count": len(thread_data["messages"])
        })
    
    # Sort by last message time
    result.sort(key=lambda x: x["last_message_time"], reverse=True)
    
    return result

@router.put("/messages/{message_id}/read", response_model=dict)
async def mark_message_read(
    message_id: str,
    current_user: dict = Depends(get_current_student)
):
    """Mark a message as read"""
    db = get_database()
    
    result = await db.messages.update_one(
        {"_id": ObjectId(message_id), "recipient_id": str(current_user["_id"])},
        {"$set": {"read": True}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Message not found")
    
    return {"message": "Message marked as read"}

@router.websocket("/notifications/ws")
async def notifications_websocket(websocket: WebSocket):
    """WebSocket endpoint for real-time notifications"""
    # Authenticate via query parameter
    token = websocket.query_params.get("token")
    current_user = await get_websocket_user(websocket, token)
    
    if not current_user:
        return
    
    user_id = str(current_user["_id"])
    await connection_manager.connect(websocket, user_id)
    
    try:
        while True:
            try:
                data = await websocket.receive_text()
                if data == "ping":
                    await websocket.send_text("pong")
            except WebSocketDisconnect:
                break
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id}: {e}")
    finally:
        connection_manager.disconnect(websocket, user_id)

@router.get("/faculties", response_model=List[dict])
async def get_faculties(current_user: dict = Depends(get_current_student)):
    """Get list of faculties that students can message"""
    db = get_database()
    
    # Get all faculties
    faculties = await db.users.find({"role": "faculty"}).to_list(length=1000)
    
    result = []
    for faculty in faculties:
        faculty_data = {k: v for k, v in faculty.items() if k != "password"}
        faculty_data = convert_object_ids(faculty_data)
        if "_id" in faculty_data:
            faculty_data["id"] = faculty_data.get("id") or faculty_data["_id"]
        result.append({
            "id": faculty_data["id"],
            "full_name": faculty_data.get("full_name", "Unknown"),
            "email": faculty_data.get("email", ""),
            "role": "faculty"
        })
    
    return result

@router.get("/qr-code", response_model=dict)
async def get_qr_code(current_user: dict = Depends(get_current_student)):
    student_id = current_user.get("student_id")
    if not student_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student ID not found"
        )
    
    # Generate QR code
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(student_id)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    
    # Convert to base64
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    img_str = base64.b64encode(buffer.getvalue()).decode()
    
    return {
        "student_id": student_id,
        "qr_code": f"data:image/png;base64,{img_str}"
    }



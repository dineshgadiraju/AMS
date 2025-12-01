from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Body
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import cv2
import numpy as np
import base64
import os
import asyncio
import logging
import uuid
from app.models import AttendanceCreate, Attendance, AttendanceReport, MessageCreate
from app.auth import get_current_faculty, get_websocket_user
from app.database import get_database
from app.services.face_recognition import face_recognition_service
from app.config import settings
from app.utils.websocket_manager import connection_manager
from bson import ObjectId

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/classes", response_model=List[dict])
async def get_faculty_classes(current_user: dict = Depends(get_current_faculty)):
    
    db = get_database()
    if current_user.get("role") == "admin":
        classes = await db.classes.find().to_list(length=1000)
    else:
        classes = await db.classes.find({"faculty_id": str(current_user["_id"])}).to_list(length=1000)
    result = []
    for cls in classes:

        enrolled_students = cls.get("enrolled_students", [])
        students_with_attendance = [] 
        for student_id in enrolled_students:
            student = await db.users.find_one({"student_id": student_id})
            if not student:
                continue    
            total_classes = await db.attendance.count_documents({"class_id": str(cls["_id"])})
            present_count = await db.attendance.count_documents({
                "class_id": str(cls["_id"]),
                "present_students": student_id
            })
            attendance_percentage = (present_count / total_classes * 100) if total_classes > 0 else 0
            students_with_attendance.append({
                "student_id": student_id,
                "user_id": str(student["_id"]),
                "name": student.get("full_name"),
                "email": student.get("email"),
                "attendance_percentage": round(attendance_percentage, 2),
                "total_classes": total_classes,
                "present_count": present_count
            })
        
        cls_dict = {
            "id": str(cls["_id"]),
            "name": cls.get("name"),
            "code": cls.get("code"),
            "description": cls.get("description"),
            "schedule": cls.get("schedule"),
            "enrolled_students": students_with_attendance
        }
        result.append(cls_dict)
    
    return result

@router.post("/attendance/manual", response_model=dict)
async def take_manual_attendance(attendance_data: AttendanceCreate, current_user: dict = Depends(get_current_faculty)):

    db = get_database()
    cls = await db.classes.find_one({"_id": ObjectId(attendance_data.class_id)})
    if not cls:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")
    if current_user.get("role") != "admin" and str(cls.get("faculty_id")) != str(current_user["_id"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this class")
    now = datetime.utcnow()
    if hasattr(attendance_data, 'model_dump'):
        attendance_dict = attendance_data.model_dump()
    else:
        attendance_dict = attendance_data.dict()
    attendance_dict["created_by"] = str(current_user["_id"])
    attendance_dict["mode"] = "manual"
    attendance_dict["timestamp"] = now.isoformat()
    attendance_dict["created_at"] = now
    if "date" not in attendance_dict or not attendance_dict["date"]:
        attendance_dict["date"] = now
    result = await db.attendance.insert_one(attendance_dict)
    return {
        "message": "Attendance recorded successfully",
        "attendance_id": str(result.inserted_id)
    }

@router.post("/attendance/auto", response_model=dict)
async def take_auto_attendance(
    attendance_data: Dict[str, Any] = Body(...),
    current_user: dict = Depends(get_current_faculty)
):
    db = get_database()
    class_id = attendance_data.get("class_id")
    recognized_students = attendance_data.get("recognized_students", [])
    total_faces_detected = attendance_data.get("total_faces_detected", 0)
    total_faces_recognized = attendance_data.get("total_faces_recognized", 0)
    if not class_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="class_id is required")
    if not recognized_students:
        recognized_students = []
    try:
        cls = await db.classes.find_one({"_id": ObjectId(class_id)})
    except Exception as e:
        logger.error(f"Error converting class_id to ObjectId: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid class_id format: {class_id}")
    if not cls:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")
    if current_user.get("role") != "admin" and str(cls.get("faculty_id")) != str(current_user["_id"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this class")

    enrolled_students = cls.get("enrolled_students", [])
    valid_students = [s for s in recognized_students if s in enrolled_students]
    if len(valid_students) != len(recognized_students):
        invalid_students = [s for s in recognized_students if s not in enrolled_students]
        logger.warning(f"Some recognized students are not enrolled: {invalid_students}")

    now = datetime.utcnow()
    attendance_dict = {
        "class_id": class_id,
        "date": now,
        "timestamp": now.isoformat(),
        "mode": "auto",
        "present_students": valid_students,
        "recognized_students": valid_students,
        "total_faces_detected": total_faces_detected,
        "total_faces_recognized": total_faces_recognized,
        "created_by": str(current_user["_id"]),
        "created_at": now
    }
    
    result = await db.attendance.insert_one(attendance_dict)
    logger.info(f"Attendance recorded: {len(valid_students)} students for class {class_id}")
    
    return {
        "message": "Attendance recorded successfully",
        "attendance_id": str(result.inserted_id),
        "total_faces_detected": total_faces_detected,
        "total_faces_recognized": total_faces_recognized,
        "students_marked": len(valid_students),
        "students_list": valid_students
    }

@router.websocket("/attendance/auto/stream/{class_id}")
async def attendance_stream(websocket: WebSocket, class_id: str):
    try:
        await websocket.accept()
        logger.info(f"WebSocket connection accepted for class_id: {class_id}")
    except Exception as e:
        logger.error(f"Failed to accept WebSocket connection: {e}", exc_info=True)
        try:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=f"Connection failed: {str(e)}")
        except:
            pass
        return
    
    db = get_database()
    
    try:
        cls = await db.classes.find_one({"_id": ObjectId(class_id)})
    except Exception as e:
        logger.error(f"Error finding class {class_id}: {e}")
        try:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid class ID")
        except:
            pass
        return
    
    if not cls:
        logger.error(f"Class not found: {class_id}")
        try:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Class not found")
        except:
            pass
        return
    
    # Get enrolled students and load their face encodings
    enrolled_students = cls.get("enrolled_students", [])
    
    if not enrolled_students:
        logger.warning(f"No students enrolled in class {class_id}")
    
    known_encodings = face_recognition_service.load_all_face_encodings(enrolled_students)
    logger.info(f"Loaded face encodings for {len(known_encodings)} students")
    
    if len(known_encodings) == 0:
        logger.warning(f"No face encodings loaded for class {class_id}")
    
    frame_count = last_sent_time = frames_received = frames_processed = frames_with_faces = 0
    
    should_stop = False
    
    try:
        while True:
            try:
                if should_stop:
                    break
                
                try:
                    message = await asyncio.wait_for(websocket.receive(), timeout=0.01)
                    
                    # Check message type and extract data
                    if "text" in message:
                        data = message["text"]
                    elif "bytes" in message:
                        data = message["bytes"].decode('utf-8')
                    else:
                        logger.warning(f"Unknown message type: {list(message.keys())}")
                        continue
                    
                except asyncio.TimeoutError:
                    if should_stop:
                        break
                    continue
                except WebSocketDisconnect:
                    logger.info("Client disconnected")
                    break
                except Exception as receive_error:
                    logger.error(f"Error receiving message: {receive_error}")
                    if should_stop:
                        break
                    continue
                
                frames_received += 1
                
                try:
                    frame_data = json.loads(data)
                except json.JSONDecodeError as json_error:
                    logger.error(f"JSON decode error (message {frames_received}): {json_error}")
                    continue
                
                # Check if this is a stop message from client
                if isinstance(frame_data, dict) and frame_data.get("action") == "stop":
                    logger.info(f"Stop message received. Stats: {frames_received} received, {frames_processed} processed, {frames_with_faces} with faces")
                    should_stop = True
                    try:
                        await websocket.send_json({"status": "stopped", "message": "Processing stopped"})
                    except Exception as ack_error:
                        logger.warning(f"Could not send stop acknowledgment: {ack_error}")
                    
                    try:
                        await websocket.close(code=1000, reason="Stop detection requested")
                    except Exception as close_error:
                        logger.warning(f"Error closing WebSocket: {close_error}")
                    
                    break
                
                # If stop flag is set, skip this frame entirely
                if should_stop:
                    try:
                        await websocket.close(code=1000, reason="Stop detection requested")
                    except Exception:
                        pass
                    
                    # Drain remaining messages quickly without processing
                    drain_count = 0
                    try:
                        while True:
                            try:
                                await asyncio.wait_for(websocket.receive(), timeout=0.01)
                                drain_count += 1
                            except (asyncio.TimeoutError, Exception):
                                break
                        if drain_count > 0:
                            logger.info(f"Drained {drain_count} queued messages without processing")
                    except Exception:
                        pass
                    break
                
                if "image" not in frame_data:
                    continue
                
                if should_stop:
                    break
                
                frame_count += 1
                
                if should_stop:
                    break
                
                # Decode base64 image
                try:
                    image_base64 = frame_data.get("image")
                    if not image_base64 or len(image_base64) == 0:
                        continue
                    
                    if should_stop:
                        break
                    
                    # Decode base64 to bytes
                    try:
                        image_data = base64.b64decode(image_base64, validate=True)
                    except Exception as b64_error:
                        logger.error(f"Base64 decode error (frame {frame_count}): {b64_error}")
                        continue
                    
                    if should_stop:
                        break
                    
                    if len(image_data) == 0:
                        continue
                    
                    # Convert bytes to numpy array
                    try:
                        nparr = np.frombuffer(image_data, np.uint8)
                    except Exception as np_error:
                        logger.error(f"NumPy frombuffer error (frame {frame_count}): {np_error}")
                        continue
                    
                    if should_stop:
                        break
                    
                    # Decode JPEG/PNG image
                    try:
                        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    except Exception as cv_error:
                        logger.error(f"OpenCV decode error (frame {frame_count}): {cv_error}")
                        continue
                    
                    if should_stop:
                        break
                    
                    if frame is None or frame.size == 0:
                        continue
                    
                    # Validate frame dimensions
                    if len(frame.shape) != 3 or frame.shape[2] != 3:
                        continue
                    
                    if should_stop:
                        break
                    
                    frames_processed += 1
                    
                except Exception as decode_error:
                    logger.error(f"Error decoding image (frame {frame_count}): {decode_error}", exc_info=True)
                    continue
                
                if should_stop:
                    break
                
                # Recognize faces
                try:
                    if frame is None or frame.size == 0:
                        recognized_ids = []
                        total_detected = 0
                        total_recognized = 0
                        face_detections = []
                    else:
                        if should_stop:
                            break
                        
                        recognized_ids, total_detected, total_recognized, face_detections = face_recognition_service.recognize_faces_in_frame(
                            frame, known_encodings
                        )
                        
                        # Save debug frame if faces detected (first 5 frames or when faces found)
                        if total_detected > 0 and (frame_count <= 5 or len(face_detections) > 0):
                            debug_frame = frame.copy()
                            for det in face_detections:
                                x, y, w, h = det['x'], det['y'], det['width'], det['height']
                                color = (0, 255, 0) if det['recognized'] else (0, 0, 255)
                                cv2.rectangle(debug_frame, (x, y), (x + w, y + h), color, 2)
                                label = det['student_id'] if det['recognized'] else "Unknown"
                                cv2.putText(debug_frame, label, (x, max(y - 10, 20)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
                            
                            debug_dir = os.path.join(settings.face_data_dir, "debug_frames")
                            os.makedirs(debug_dir, exist_ok=True)
                            debug_path = os.path.join(debug_dir, f"frame_{frame_count}_detected_{class_id}.jpg")
                            cv2.imwrite(debug_path, debug_frame)
                except Exception as recognition_error:
                    logger.error(f"Error recognizing faces (frame {frame_count}): {recognition_error}", exc_info=True)
                    recognized_ids = []
                    total_detected = 0
                    total_recognized = 0
                    face_detections = []
                
                if total_detected > 0:
                    frames_with_faces += 1
                
                # Create annotated frame for video stream
                annotated_frame = None
                if frame is not None:
                    annotated_frame = frame.copy()
                    if len(face_detections) > 0:
                        for det in face_detections:
                            x, y, w, h = det['x'], det['y'], det['width'], det['height']
                            color = (0, 255, 0) if det['recognized'] else (0, 0, 255)
                            cv2.rectangle(annotated_frame, (x, y), (x + w, y + h), color, 2)
                            label = det['student_id'] if det['recognized'] else "Unknown"
                            cv2.putText(annotated_frame, label, (x, max(y - 10, 20)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
                
                # Encode annotated frame to base64 for video stream
                frame_base64 = None
                if annotated_frame is not None:
                    try:
                        _, buffer = cv2.imencode('.jpg', annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                        frame_base64 = base64.b64encode(buffer).decode('utf-8')
                    except Exception as encode_error:
                        logger.error(f"Error encoding frame for stream (frame {frame_count}): {encode_error}")
                
                if should_stop:
                    break
                
                # Send recognition result with annotated frame
                try:
                    response_data = {
                        "recognized_students": recognized_ids,
                        "total_faces_detected": total_detected,
                        "total_faces_recognized": total_recognized,
                        "face_detections": face_detections
                    }
                    if frame_base64:
                        response_data["annotated_frame"] = frame_base64
                    
                    await websocket.send_json(response_data)
                    last_sent_time = frame_count
                except Exception as send_error:
                    logger.error(f"Error sending recognition result (frame {frame_count}): {send_error}")
                    if "closed" in str(send_error).lower() or "disconnect" in str(send_error).lower():
                        should_stop = True
                        break
                    break
                    
            except Exception as e:
                logger.error(f"Error processing frame {frame_count}: {e}", exc_info=True)
                continue
    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for class_id: {class_id}. Stats: {frames_received} received, {frames_processed} processed, {frames_with_faces} with faces")
    except Exception as e:
        logger.error(f"WebSocket error for class_id {class_id}: {e}", exc_info=True)
        logger.info(f"Final Stats: {frames_received} received, {frames_processed} processed, {frames_with_faces} with faces")
        try:
            await websocket.close()
        except:
            pass

@router.get("/attendance/history", response_model=List[dict])
async def get_attendance_history(
    class_id: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: dict = Depends(get_current_faculty)
):
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
    
    # Filter by faculty if not admin
    if current_user.get("role") != "admin":
        classes = await db.classes.find({"faculty_id": str(current_user["_id"])}).to_list(length=1000)
        class_ids = [str(cls["_id"]) for cls in classes]
        if class_id and class_id not in class_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized"
            )
        if not class_id:
            query["class_id"] = {"$in": class_ids}
    
    attendance_records = await db.attendance.find(query).sort("date", -1).to_list(length=1000)
    
    result = []
    for record in attendance_records:
        cls = await db.classes.find_one({"_id": ObjectId(record["class_id"])})
        record_dict = {
            "id": str(record["_id"]),
            "class_id": record["class_id"],
            "class_name": cls.get("name") if cls else "Unknown",
            "date": record["date"],
            "timestamp": record.get("timestamp") or record.get("created_at").isoformat() if record.get("created_at") else None,
            "mode": record["mode"],
            "present_students": record.get("present_students", []),
            "total_faces_detected": record.get("total_faces_detected"),
            "total_faces_recognized": record.get("total_faces_recognized")
        }
        result.append(record_dict)
    
    return result

@router.get("/reports", response_model=List[dict])
async def get_reports(
    class_id: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    mode: Optional[str] = None,
    current_user: dict = Depends(get_current_faculty)
):
    
    db = get_database()
    
    if class_id:
        cls = await db.classes.find_one({"_id": ObjectId(class_id)})
        if not cls:
            raise HTTPException(status_code=404, detail="Class not found")
        classes = [cls]
    else:
        if current_user.get("role") == "admin":
            classes = await db.classes.find().to_list(length=1000)
        else:
            classes = await db.classes.find({"faculty_id": str(current_user["_id"])}).to_list(length=1000)
    
    # Build date filter query
    date_query = {}
    if start_date or end_date:
        date_query = {}
        if start_date:
            date_query["$gte"] = start_date
        if end_date:
            date_query["$lte"] = end_date
    
    # Validate mode if provided
    if mode and mode not in ["manual", "auto"]:
        raise HTTPException(status_code=400, detail="Invalid mode. Must be 'manual' or 'auto'")
    
    reports = []
    for cls in classes:
        enrolled_students = cls.get("enrolled_students", [])
        attendance_data = []
        
        for student_id in enrolled_students:
            student = await db.users.find_one({"student_id": student_id})
            if not student:
                continue
            
            # Build queries with date and mode filters
            total_query = {"class_id": str(cls["_id"])}
            present_query = {
                "class_id": str(cls["_id"]),
                "present_students": student_id
            }
            
            if date_query:
                total_query["date"] = date_query
                present_query["date"] = date_query
            
            if mode:
                total_query["mode"] = mode
                present_query["mode"] = mode
            
            total_classes = await db.attendance.count_documents(total_query)
            present_count = await db.attendance.count_documents(present_query)
            attendance_percentage = (present_count / total_classes * 100) if total_classes > 0 else 0
            
            attendance_data.append({
                "student_id": student_id,
                "student_name": student.get("full_name"),
                "total_classes": total_classes,
                "present_count": present_count,
                "attendance_percentage": round(attendance_percentage, 2)
            })
        
        reports.append({
            "class_id": str(cls["_id"]),
            "class_name": cls.get("name"),
            "students": attendance_data
        })
    
    return reports

@router.get("/reports/download")
async def download_report(
    class_id: Optional[str] = None, 
    start_date: Optional[datetime] = None, 
    end_date: Optional[datetime] = None,
    mode: Optional[str] = None,
    format: str = "csv", 
    current_user: dict = Depends(get_current_faculty)
):

    from fastapi.responses import Response
    from io import StringIO
    import csv
    
    db = get_database()
    
    if class_id:
        cls = await db.classes.find_one({"_id": ObjectId(class_id)})
        if not cls:
            raise HTTPException(status_code=404, detail="Class not found")
        classes = [cls]
    else:
        if current_user.get("role") == "admin":
            classes = await db.classes.find().to_list(length=1000)
        else:
            classes = await db.classes.find({"faculty_id": str(current_user["_id"])}).to_list(length=1000)
    
    date_query = {}
    if start_date or end_date:
        date_query = {}
        if start_date:
            date_query["$gte"] = start_date
        if end_date:
            date_query["$lte"] = end_date
    
    # Validate mode if provided
    if mode and mode not in ["manual", "auto"]:
        raise HTTPException(status_code=400, detail="Invalid mode. Must be 'manual' or 'auto'")
    
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Class Name", "Student ID", "Student Name", "Total Classes", "Present", "Attendance Percentage"])
    
    for cls in classes:
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
            
            if mode:
                total_query["mode"] = mode
                present_query["mode"] = mode
            
            total_classes = await db.attendance.count_documents(total_query)
            present_count = await db.attendance.count_documents(present_query)
            attendance_percentage = (present_count / total_classes * 100) if total_classes > 0 else 0
            
            writer.writerow([
                class_name,
                student_id,
                student.get("full_name", "Unknown"),
                total_classes,
                present_count,
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

@router.post("/notifications/send")
async def send_notification(
    message_data: MessageCreate,
    current_user: dict = Depends(get_current_faculty)
):
    db = get_database()
    
    # Verify recipient exists
    recipient = await db.users.find_one({"_id": ObjectId(message_data.recipient_id)})
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
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
        "message": "Notification sent successfully",
        "message_id": message_id,
        "thread_id": thread_id
    }

@router.post("/messages/reply")
async def reply_to_message(
    message_data: MessageCreate,
    current_user: dict = Depends(get_current_faculty)
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
        "subject": f"Re: {original_message.get('subject', 'Notification')}",
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

@router.get("/messages", response_model=List[dict])
async def get_messages(
    unread_only: bool = False,
    thread_id: Optional[str] = None,
    current_user: dict = Depends(get_current_faculty)
):
    """Get messages for faculty"""
    db = get_database()
    
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
async def get_message_threads(current_user: dict = Depends(get_current_faculty)):
    """Get all message threads for faculty"""
    db = get_database()
    
    messages = await db.messages.find({
        "$or": [
            {"recipient_id": str(current_user["_id"])},
            {"sender_id": str(current_user["_id"])}
        ]
    }).sort("created_at", -1).to_list(length=1000)
    
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
        
        if msg.get("recipient_id") == str(current_user["_id"]) and not msg.get("read", False):
            threads[thread_id]["unread_count"] += 1
    
    result = []
    for thread_id, thread_data in threads.items():
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
    
    result.sort(key=lambda x: x["last_message_time"], reverse=True)
    return result

@router.put("/messages/{message_id}/read", response_model=dict)
async def mark_message_read(
    message_id: str,
    current_user: dict = Depends(get_current_faculty)
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
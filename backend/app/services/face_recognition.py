import face_recognition
import cv2
import numpy as np
import os
import pickle
from typing import List, Tuple, Optional
from app.config import settings

class FaceRecognitionService:
    def __init__(self):
        self.face_data_dir = settings.face_data_dir
        os.makedirs(self.face_data_dir, exist_ok=True)
    
    def save_face_encodings(self, student_id: str, encodings: List[np.ndarray]):
        """Save face encodings for a student"""
        file_path = os.path.join(self.face_data_dir, f"{student_id}.pkl")
        with open(file_path, 'wb') as f:
            pickle.dump(encodings, f)
        return file_path
    
    def load_face_encodings(self, student_id: str) -> Optional[List[np.ndarray]]:
        """Load face encodings for a student"""
        file_path = os.path.join(self.face_data_dir, f"{student_id}.pkl")
        if not os.path.exists(file_path):
            return None
        with open(file_path, 'rb') as f:
            return pickle.load(f)
    
    def encode_face_from_image(self, image_path: str) -> Optional[np.ndarray]:
        """Encode a single face from an image file path"""
        image = face_recognition.load_image_file(image_path)
        face_encodings = face_recognition.face_encodings(image)
        if len(face_encodings) > 0:
            return face_encodings[0]
        return None
    
    def encode_face_from_bytes(self, image_bytes: bytes) -> Optional[np.ndarray]:
        """Encode a single face from image bytes"""
        import io
        from PIL import Image
        image = Image.open(io.BytesIO(image_bytes))
        image_array = np.array(image)
        face_encodings = face_recognition.face_encodings(image_array)
        if len(face_encodings) > 0:
            return face_encodings[0]
        return None
    
    def process_training_images(self, image_paths: List[str]) -> List[np.ndarray]:
        """Process multiple training images and return encodings"""
        encodings = []
        for image_path in image_paths:
            encoding = self.encode_face_from_image(image_path)
            if encoding is not None:
                encodings.append(encoding)
        return encodings
    
    def recognize_faces_in_frame(self, frame: np.ndarray, known_encodings: dict) -> Tuple[List[str], int, int, List[dict]]:
        if frame is None or frame.size == 0:
            return [], 0, 0, []
        
        if len(frame.shape) != 3 or frame.shape[2] != 3:
            return [], 0, 0, []
        
        try:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Error converting BGR to RGB: {e}")
            return [], 0, 0, []
        
        try:
            face_locations = face_recognition.face_locations(rgb_frame, model="hog")
            face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)
            
            if len(face_encodings) != len(face_locations):
                import logging
                logging.getLogger(__name__).warning(f"Found {len(face_locations)} faces but only {len(face_encodings)} encodings")
                
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Error in face_recognition library: {e}", exc_info=True)
            return [], 0, 0, []
        
        total_detected = len(face_locations)
        recognized_ids = []
        face_detections = []
       
        if not known_encodings or len(known_encodings) == 0:
            for face_location in face_locations:
                top, right, bottom, left = face_location
                face_detections.append({
                    "x": int(left),
                    "y": int(top),
                    "width": int(right - left),
                    "height": int(bottom - top),
                    "student_id": None,
                    "recognized": False
                })
            return [], total_detected, 0, face_detections
        
        for i, (face_location, face_encoding) in enumerate(zip(face_locations, face_encodings)):
            try:
                top, right, bottom, left = face_location
                x = left
                y = top
                width = right - left
                height = bottom - top
                
                if width <= 0 or height <= 0:
                    continue
                
                recognized = False
                student_id = None
                
                try:
                    best_match_score = 1.0
                    best_match_id = None
                    
                    for sid, known_encoding_list in known_encodings.items():
                        if not known_encoding_list or len(known_encoding_list) == 0:
                            continue
                        
                        matches = face_recognition.compare_faces(known_encoding_list, face_encoding, tolerance=0.6)
                        
                        if any(matches):
                            face_distances = face_recognition.face_distance(known_encoding_list, face_encoding)
                            min_distance = min(face_distances)
                            
                            if min_distance < best_match_score:
                                best_match_score = min_distance
                                best_match_id = sid
                    
                    if best_match_id:
                        recognized_ids.append(best_match_id)
                        recognized = True
                        student_id = best_match_id
                    else:
                        pass
                        
                except Exception as compare_error:
                    import logging
                    logging.getLogger(__name__).error(f"Error comparing faces: {compare_error}", exc_info=True)
                    recognized = False
                    student_id = None
                
                face_detections.append({
                    "x": int(x),
                    "y": int(y),
                    "width": int(width),
                    "height": int(height),
                    "student_id": student_id,
                    "recognized": recognized
                })
            except Exception as face_error:
                import logging
                logging.getLogger(__name__).error(f"Error processing face {i}: {face_error}")
                continue
        
        return recognized_ids, total_detected, len(recognized_ids), face_detections
    
    def load_all_face_encodings(self, student_ids: List[str]) -> dict:
        """Load face encodings for multiple students"""
        encodings_dict = {}
        for student_id in student_ids:
            encodings = self.load_face_encodings(student_id)
            if encodings:
                encodings_dict[student_id] = encodings
        return encodings_dict

face_recognition_service = FaceRecognitionService()
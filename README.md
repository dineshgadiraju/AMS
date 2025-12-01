# Attendance Management System

A comprehensive face recognition-based attendance management system built with React, FastAPI, and MongoDB.

## Features

### Admin Features
- Add and manage students and faculties
- Create class schedules and assign faculty
- View and download statistical data reports
- Enable/disable students
- Automatic student ID generation
- Face data capture during registration (default 25 images, configurable)
- System settings management

### Faculty Features
- Take attendance for assigned classes (Manual or Auto mode)
- Auto mode with face recognition:
  - Real-time face detection and recognition
  - Camera view during attendance capture
  - Shows detection statistics (total detected vs recognized)
  - Asynchronous face recognition processing
- View enrolled students with attendance percentages
- View and download reports
- Send notifications to students

### Student Features
- Login to the system
- Enroll in available classes
- View and download attendance reports and enrollment history
- Send messages to faculty or admin
- Update profile (address, secondary mobile - full name and primary mobile cannot be changed)
- Display QR code

## Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS
- **Backend**: FastAPI, Python 3.8+
- **Database**: MongoDB
- **Face Recognition**: face-recognition library (dlib backend)
- **Authentication**: JWT tokens

## Prerequisites

- Python 3.8 or higher
- Node.js 16 or higher
- MongoDB (local or cloud instance)
- Webcam (for face recognition features)

## Installation

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Create a `.env` file in the backend directory:
```env
MONGODB_URL=mongodb://localhost:27017
DATABASE_NAME=attendance_system
SECRET_KEY=your-secret-key-here-change-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
FACE_IMAGES_COUNT=25
UPLOAD_DIR=uploads
FACE_DATA_DIR=face_data
```

5. Create necessary directories:
```bash
mkdir -p uploads face_data
```

6. Run the backend server:
```bash
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The frontend will be available at `http://localhost:3000`

## Usage

### Initial Setup

1. Start MongoDB
2. Start the backend server
3. Start the frontend server
4. Register an admin user through the API or directly in MongoDB

### Creating Admin User

You can create an admin user by making a POST request to `/api/auth/register`:

```json
{
  "email": "admin@example.com",
  "password": "admin123",
  "full_name": "Admin User",
  "primary_mobile": "1234567890",
  "role": "admin"
}
```

### Face Recognition Setup

The system uses the `face-recognition` library which requires:
- dlib (C++ library)
- CMake
- Visual Studio Build Tools (on Windows)

Installation instructions for face-recognition can be found at: https://github.com/ageitgey/face_recognition

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user info

### Admin Endpoints
- `POST /api/admin/students` - Add student
- `POST /api/admin/students/{student_id}/face-data` - Upload face data
- `GET /api/admin/students` - Get all students
- `PUT /api/admin/students/{student_id}/status` - Toggle student status
- `POST /api/admin/faculties` - Add faculty
- `GET /api/admin/faculties` - Get all faculties
- `POST /api/admin/classes` - Create class
- `GET /api/admin/classes` - Get all classes
- `GET /api/admin/reports/attendance` - Get attendance reports
- `PUT /api/admin/settings/face-images-count` - Update face images count

### Faculty Endpoints
- `GET /api/faculty/classes` - Get assigned classes
- `POST /api/faculty/attendance/manual` - Take manual attendance
- `POST /api/faculty/attendance/auto` - Take auto attendance
- `WS /api/faculty/attendance/auto/stream/{class_id}` - WebSocket for real-time recognition
- `GET /api/faculty/attendance/history` - Get attendance history
- `GET /api/faculty/reports` - Get reports
- `POST /api/faculty/notifications/send` - Send notification

### Student Endpoints
- `GET /api/student/profile` - Get profile
- `PUT /api/student/profile` - Update profile
- `GET /api/student/classes/available` - Get available classes
- `GET /api/student/classes/enrolled` - Get enrolled classes
- `POST /api/student/classes/{class_id}/enroll` - Enroll in class
- `GET /api/student/attendance/reports` - Get attendance reports
- `GET /api/student/qr-code` - Get QR code
- `POST /api/student/messages/send` - Send message
- `GET /api/student/messages` - Get messages

## Project Structure

```
.
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models.py
│   │   ├── auth.py
│   │   ├── routers/
│   │   │   ├── auth.py
│   │   │   ├── admin.py
│   │   │   ├── faculty.py
│   │   │   └── student.py
│   │   └── services/
│   │       └── face_recognition.py
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── contexts/
│   │   ├── pages/
│   │   │   ├── admin/
│   │   │   ├── faculty/
│   │   │   └── student/
│   │   ├── services/
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
└── README.md
```

## Notes

- Face recognition requires good lighting and clear face visibility
- The default number of training images is 25, but this can be changed in settings
- WebSocket is used for real-time face recognition in auto attendance mode
- All sensitive data should be properly secured in production
- Make sure to change the SECRET_KEY in production

## License

This project is open source and available under the MIT License.



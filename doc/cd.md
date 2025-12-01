# Communication Diagrams - Visual Format

This document contains visual communication diagrams for all scenarios in the Attendance Management System.

---

## 1. Authentication Flow

```mermaid
flowchart LR
    A[User] -->|1. Login| B[Login Page]
    B -->|2. Credentials| C[Auth Router]
    C -->|3. Validate| D[Database]
    D -->|4. Token| C
    C -->|5. JWT| B
    B -->|6. Store| E[Frontend]
```

---

## 2. Admin - Add Student Flow

```mermaid
flowchart LR
    A[Admin] -->|1. Add| B[Admin Dashboard]
    B -->|2. StudentData| C[Admin Router]
    C -->|3. Create| D[Database]
    D -->|4. StudentID| C
    C -->|5. Response| B
    B -->|6. Display| A
```

---

## 3. Admin - Upload Face Data Flow

```mermaid
flowchart LR
    A[Admin] -->|1. Upload| B[Admin Dashboard]
    B -->|2. Images| C[Admin Router]
    C -->|3. Encode| D[Face Recognition]
    D -->|4. Encodings| E[File System]
    E -->|5. Path| C
    C -->|6. Update| F[Database]
    F -->|7. Confirmation| C
    C -->|8. Success| B
```

---

## 4. Faculty - Manual Attendance Flow

```mermaid
flowchart LR
    A[Faculty] -->|1. Select| B[Faculty Dashboard]
    B -->|2. Attendance| C[Faculty Router]
    C -->|3. Save| D[Database]
    D -->|4. Confirmation| C
    C -->|5. Response| B
    B -->|6. Display| A
```

---

## 5. Faculty - Auto Attendance Flow (Face Recognition)

```mermaid
flowchart TD
    A[Faculty] -->|1. Start| B[Faculty Dashboard]
    B -->|2. Connect| C[Faculty Router]
    C -->|3. Accept| D[WebSocket]
    D -->|4. Load| E[Face Recognition]
    E -->|5. Encodings| D
    B -->|6. Frame| D
    D -->|7. Recognize| E
    E -->|8. Results| D
    D -->|9. Annotated| B
    B -->|10. Finalize| C
    C -->|11. Save| F[Database]
    F -->|12. Confirmation| C
    C -->|13. Success| B
```

---

## 6. Student - Enroll in Class Flow

```mermaid
flowchart LR
    A[Student] -->|1. Enroll| B[Student Dashboard]
    B -->|2. ClassID| C[Student Router]
    C -->|3. Check| D[Database]
    D -->|4. Update| D
    D -->|5. Confirmation| C
    C -->|6. Success| B
    B -->|7. Display| A
```

---

## 7. Student - View Attendance Flow

```mermaid
flowchart LR
    A[Student] -->|1. View| B[Student Dashboard]
    B -->|2. Request| C[Student Router]
    C -->|3. Query| D[Database]
    D -->|4. Records| C
    C -->|5. Process| C
    C -->|6. Data| B
    B -->|7. Display| A
```

---

## 8. Faculty - Send Notification Flow

```mermaid
flowchart TD
    A[Faculty] -->|1. Send| B[Faculty Dashboard]
    B -->|2. Message| C[Faculty Router]
    C -->|3. Save| D[Database]
    D -->|4. MessageID| C
    C -->|5. Notify| E[WebSocket Manager]
    E -->|6. Push| F[Student WebSocket]
    F -->|7. Real-time| G[Frontend]
    G -->|8. Display| H[Student]
    C -->|9. Success| B
```

---

## 9. Admin - View Reports Flow

```mermaid
flowchart LR
    A[Admin] -->|1. View| B[Admin Dashboard]
    B -->|2. Filters| C[Admin Router]
    C -->|3. Query| D[Database]
    D -->|4. Data| C
    C -->|5. Aggregate| C
    C -->|6. Reports| B
    B -->|7. Display| A
```

---

## 10. Student - Send Message Flow

```mermaid
flowchart TD
    A[Student] -->|1. Send| B[Student Dashboard]
    B -->|2. Message| C[Student Router]
    C -->|3. Save| D[Database]
    D -->|4. MessageID| C
    C -->|5. Notify| E[WebSocket Manager]
    E -->|6. Push| F[Faculty/Admin WS]
    F -->|7. Real-time| G[Frontend]
    G -->|8. Display| H[Faculty/Admin]
    C -->|9. Success| B
```

---

## 11. Admin - Create Class Flow

```mermaid
flowchart LR
    A[Admin] -->|1. Create| B[Admin Dashboard]
    B -->|2. ClassData| C[Admin Router]
    C -->|3. Validate| D[Database]
    D -->|4. Create| D
    D -->|5. ClassID| C
    C -->|6. Success| B
    B -->|7. Display| A
```

---

## 12. Student - Get QR Code Flow

```mermaid
flowchart LR
    A[Student] -->|1. Request| B[Student Dashboard]
    B -->|2. StudentID| C[Student Router]
    C -->|3. Generate| D[QR Generator]
    D -->|4. QR Image| C
    C -->|5. Base64| C
    C -->|6. QR Data| B
    B -->|7. Display| A
```

---

## Complete System Overview

```mermaid
flowchart TB
    subgraph "Frontend Layer"
        A1[Admin Dashboard]
        A2[Faculty Dashboard]
        A3[Student Dashboard]
        A4[Login Page]
    end
    
    subgraph "Backend API Layer"
        B1[Auth Router]
        B2[Admin Router]
        B3[Faculty Router]
        B4[Student Router]
    end
    
    subgraph "Services Layer"
        C1[Face Recognition]
        C2[WebSocket Manager]
        C3[QR Generator]
    end
    
    subgraph "Data Layer"
        D1[(MongoDB)]
        D2[File System]
    end
    
    A4 -->|1. Login| B1
    A1 -->|2. Admin Actions| B2
    A2 -->|3. Faculty Actions| B3
    A3 -->|4. Student Actions| B4
    
    B1 -->|5. Auth| D1
    B2 -->|6. CRUD| D1
    B3 -->|7. Attendance| D1
    B4 -->|8. Enrollment| D1
    
    B2 -->|9. Face Data| C1
    B3 -->|10. Recognition| C1
    C1 -->|11. Storage| D2
    
    B3 -->|12. Notifications| C2
    B4 -->|13. Notifications| C2
    C2 -->|14. Real-time| A2
    C2 -->|15. Real-time| A3
    
    B4 -->|16. QR| C3
    C3 -->|17. Image| B4
```

---

## Legend

- **Numbered Arrows**: Sequential communication steps
- **Boxes**: System components/modules
- **Flow Direction**: Left to right or top to bottom
- **Colors**: Different components for clarity

---

## Notes

- All flows assume authentication is validated
- Error paths are not shown for diagram clarity
- WebSocket connections are persistent
- Database operations are atomic where required


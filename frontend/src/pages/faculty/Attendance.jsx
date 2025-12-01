import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-toastify'
import api from '../../services/api'

function Attendance() {
  const [classes, setClasses] = useState([])
  const [selectedClass, setSelectedClass] = useState(null)
  const [mode, setMode] = useState('manual')
  const [showCamera, setShowCamera] = useState(false)
  const [selectedStudents, setSelectedStudents] = useState([])
  const [studentAttendance, setStudentAttendance] = useState({}) // {student_id: 'present' | 'absent'}
  const [recognitionStats, setRecognitionStats] = useState({
    recognized_students: [],
    total_faces_detected: 0,
    total_faces_recognized: 0
  })
  const [isStreaming, setIsStreaming] = useState(false)
  const [markedStudents, setMarkedStudents] = useState(new Set())
  const [faceDetections, setFaceDetections] = useState([]) // [{x, y, width, height, student_id, recognized}]
  const [wsConnected, setWsConnected] = useState(false)
  const [detectionStopped, setDetectionStopped] = useState(false) // Track if detection was manually stopped (for UI)
  const detectionStoppedRef = useRef(false) // Ref for immediate synchronous checks
  const [validatedStudents, setValidatedStudents] = useState(new Set()) // Students selected for final submission

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const videoContainerRef = useRef(null)
  const streamRef = useRef(null)
  const wsRef = useRef(null)
  const animationFrameRef = useRef(null)
  const lastFrameTimeRef = useRef(0)
  const frameThrottle = 100 // Send frame every 100ms (10fps)
  const frameCountRef = useRef(0) // Track frames sent

  useEffect(() => {
    fetchClasses()
  }, [])

  useEffect(() => {
    if (showCamera && mode === 'auto') {
      startCamera()
    } else {
      stopCamera()
      stopWebSocket()
    }
    return () => {
      stopCamera()
      stopWebSocket()
    }
  }, [showCamera, mode])

  const fetchClasses = async () => {
    try {
      const response = await api.get('/faculty/classes')
      setClasses(response.data)
    } catch (error) {
      toast.error('Failed to fetch classes')
    }
  }

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error('Camera not supported in this browser')
        return
      }
      
      if (!selectedClass) {
        toast.error('Please select a class first')
        return
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720 } 
      })
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        
        // Wait for video metadata to load
        await new Promise((resolve) => {
          videoRef.current.onloadedmetadata = () => {
            resolve()
          }
        })
        
        await videoRef.current.play()
        streamRef.current = stream
        setIsStreaming(true)
        
        // Start WebSocket connection after camera is ready
        setTimeout(() => {
          if (selectedClass) {
            startWebSocket()
          }
        }, 500)
        
        // DON'T start frame capture here - wait for WebSocket to open
        // Frame capture will be triggered in wsRef.current.onopen handler
      }
    } catch (error) {
      console.error('Camera error:', error)
      toast.error('Unable to access camera: ' + error.message)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    setIsStreaming(false)
    setFaceDetections([])
  }

  const startWebSocket = () => {
    if (!selectedClass || !selectedClass.id) {
      toast.error('Please select a class first')
      return
    }

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    // Use localhost:8888 for development (backend port)
    const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    const wsHost = isDevelopment ? 'localhost:8888' : window.location.host
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${wsHost}/api/faculty/attendance/auto/stream/${selectedClass.id}`
    
    // Validate class ID format (should be MongoDB ObjectId string)
    if (!selectedClass.id || selectedClass.id.length !== 24) {
      toast.error('Invalid class ID. Please select a valid class.')
      return
    }
    
    try {
      wsRef.current = new WebSocket(wsUrl)
      
      wsRef.current.onopen = () => {
        setWsConnected(true)
        toast.success('Face recognition started')
        
        // Start frame capture AFTER WebSocket is confirmed open
        setTimeout(() => {
          const videoReady = videoRef.current && 
                            videoRef.current.readyState >= videoRef.current.HAVE_CURRENT_DATA &&
                            videoRef.current.videoWidth > 0 &&
                            videoRef.current.videoHeight > 0
          
          if (videoReady && !animationFrameRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            captureFrames()
          } else {
            // Try to start anyway if WebSocket is open and video exists
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && videoRef.current) {
              frameCountRef.current = 0
              captureFrames()
            } else {
              // Retry after a longer delay
              setTimeout(() => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && videoRef.current) {
                  frameCountRef.current = 0
                  captureFrames()
                }
              }, 500)
            }
          }
        }, 100)
      }
      
      wsRef.current.onmessage = (event) => {
        if (detectionStoppedRef.current) {
          return
        }
        
        try {
          const data = JSON.parse(event.data)
          handleRecognitionResult(data)
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }
      
      wsRef.current.onerror = (error) => {
        setWsConnected(false)
        toast.error('WebSocket connection error. Please check: 1) Backend is running on port 8888, 2) Class is selected, 3) Check browser console for details.')
      }
      
      wsRef.current.onclose = (event) => {
        setWsConnected(false)
        wsRef.current = null
        
        if (event.code !== 1000 && event.code !== 1001) {
          if (isStreaming && selectedClass) {
            setTimeout(() => {
              if (isStreaming && selectedClass && !wsRef.current) {
                startWebSocket()
              }
            }, 2000)
          } else {
            toast.warn(`WebSocket connection closed (code: ${event.code}, reason: ${event.reason || 'Unknown'})`)
          }
        }
      }
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
      toast.error('Failed to create WebSocket connection: ' + error.message)
    }
  }

  const stopWebSocket = async (sendStopMessage = false) => {
    if (wsRef.current) {
      try {
        if (sendStopMessage && wsRef.current.readyState === WebSocket.OPEN) {
          try {
            const stopMessage = JSON.stringify({ action: 'stop' })
            wsRef.current.send(stopMessage)
            await new Promise(resolve => setTimeout(resolve, 100))
          } catch (sendError) {
            // Error sending stop message - continue to close
          }
        }
        
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close(1000, 'Detection stopped - closing connection')
        }
      } catch (error) {
        // Error closing WebSocket
      } finally {
        wsRef.current = null
        setWsConnected(false)
      }
    } else {
      setWsConnected(false)
    }
  }

  const captureFrames = () => {
    if (detectionStoppedRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }
    
    // Check if video is actually ready instead of relying on isStreaming state
    const videoReady = videoRef.current && 
                      videoRef.current.readyState >= videoRef.current.HAVE_CURRENT_DATA &&
                      videoRef.current.videoWidth > 0 &&
                      videoRef.current.videoHeight > 0
    
    // Check ref for immediate synchronous check
    if (detectionStoppedRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }
    
    if (!videoRef.current || !canvasRef.current || !videoReady) {
      console.warn('⚠️ captureFrames() early return - missing requirements')
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }

    const video = videoRef.current
    const canvas = canvasRef.current
    
    // Stop if detection was stopped - use ref for synchronous check
    if (detectionStoppedRef.current) {
      console.log('🛑 Detection stopped (ref) - stopping in video ready check')
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }
    
    // Wait for video to be ready
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      if (!detectionStoppedRef.current) {
        animationFrameRef.current = requestAnimationFrame(captureFrames)
      }
      return
    }

    const context = canvas.getContext('2d')

    // Set canvas size to match video exactly
    const videoWidth = video.videoWidth
    const videoHeight = video.videoHeight
    
    if (videoWidth === 0 || videoHeight === 0) {
      if (!detectionStoppedRef.current) {
        animationFrameRef.current = requestAnimationFrame(captureFrames)
      }
      return
    }
    
    // Stop if detection was stopped - use ref for synchronous check
    if (detectionStoppedRef.current) {
      console.log('🛑 Detection stopped (ref) - stopping in dimension check')
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }

    // Set canvas size to match video element's actual displayed size
    // Get the video element's bounding rect to get actual displayed size
    const videoRect = video.getBoundingClientRect()
    const displayWidth = videoRect.width
    const displayHeight = videoRect.height
    
    // Calculate scale to maintain aspect ratio (video uses objectFit: contain)
    const videoAspect = videoWidth / videoHeight
    const displayAspect = displayWidth / displayHeight
    
    let scaledWidth, scaledHeight, offsetX = 0, offsetY = 0
    
    if (displayAspect > videoAspect) {
      // Display is wider - video fits to height
      scaledHeight = displayHeight
      scaledWidth = scaledHeight * videoAspect
      offsetX = (displayWidth - scaledWidth) / 2
    } else {
      // Display is taller - video fits to width
      scaledWidth = displayWidth
      scaledHeight = scaledWidth / videoAspect
      offsetY = (displayHeight - scaledHeight) / 2
    }
    
    // Set canvas to match video element's displayed size exactly
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth
      canvas.height = displayHeight
      canvas.style.width = `${displayWidth}px`
      canvas.style.height = `${displayHeight}px`
      console.log(`Canvas resized to match video display: ${displayWidth}x${displayHeight}, video source: ${videoWidth}x${videoHeight}`)
    }
    
    // Draw face detection boxes with scaled coordinates
    drawFaceBoxes(context, displayWidth, displayHeight, videoWidth, videoHeight, offsetX, offsetY)

    // Send frame to backend via WebSocket (throttle to ~10fps for performance)
    const now = Date.now()
    const wsReady = wsRef.current && wsRef.current.readyState === WebSocket.OPEN
    const timeSinceLastFrame = now - lastFrameTimeRef.current
    
    // Debug logging for first few frames
    if (frameCountRef.current < 5) {
      console.log(`🔍 Frame capture check #${frameCountRef.current + 1}:`, {
        wsExists: !!wsRef.current,
        wsState: wsRef.current?.readyState,
        wsReady,
        timeSinceLastFrame,
        shouldSend: wsReady && timeSinceLastFrame >= frameThrottle,
        isStreaming,
        videoReady: video.readyState === video.HAVE_ENOUGH_DATA
      })
    }
    
    // Stop if detection was stopped - use ref for synchronous check
    if (detectionStoppedRef.current) {
      console.log('🛑 Detection stopped (ref) - stopping frame sending')
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }
    
    if (wsReady && timeSinceLastFrame >= frameThrottle && !detectionStoppedRef.current) {
      // Double-check stop flag before sending
      if (detectionStoppedRef.current) {
        console.log('🛑 Detection stopped (ref) - not sending frame')
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current)
          animationFrameRef.current = null
        }
        return
      }
      
      try {
        // Create a temporary canvas for sending to backend
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = videoWidth
        tempCanvas.height = videoHeight
        const tempContext = tempCanvas.getContext('2d')
        tempContext.drawImage(video, 0, 0, videoWidth, videoHeight)
        
        const imageData = tempCanvas.toDataURL('image/jpeg', 0.7)
        const base64Image = imageData.split(',')[1]
        
        if (base64Image && base64Image.length > 0) {
          try {
            if (detectionStoppedRef.current) {
              return
            }
            
            const message = JSON.stringify({ image: base64Image })
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !detectionStoppedRef.current) {
              wsRef.current.send(message)
              lastFrameTimeRef.current = now
              frameCountRef.current++
            }
          } catch (sendError) {
            console.error('❌ Error sending frame:', sendError)
            console.error('   Error details:', sendError.message, sendError.stack)
            if (frameCountRef.current === 0) {
              console.error('❌ FIRST FRAME SEND EXCEPTION:', sendError)
            }
          }
        } else {
          console.warn('⚠️ Empty image data, skipping frame')
          if (frameCountRef.current === 0) {
            console.error('❌ FIRST FRAME HAS EMPTY IMAGE DATA!')
          }
        }
      } catch (error) {
        console.error('❌ Error creating/sending frame:', error)
        console.error('   Error details:', error.message, error.stack)
      }
    } else if (!wsReady) {
      // WebSocket not ready
      if (wsRef.current) {
        const state = wsRef.current.readyState
        if (state === WebSocket.CONNECTING) {
          // Still connecting, wait
          return
        } else if (state === WebSocket.CLOSED || state === WebSocket.CLOSING) {
          // Try to reconnect if not already connecting and detection is not stopped - use ref
          if (selectedClass && isStreaming && !detectionStoppedRef.current) {
            console.log('WebSocket closed, attempting to reconnect in 1 second...')
            setTimeout(() => {
              if (isStreaming && selectedClass && !detectionStoppedRef.current && (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED)) {
                startWebSocket()
              }
            }, 1000)
          }
        }
      } else if (selectedClass && isStreaming && !detectionStoppedRef.current) {
        // No WebSocket at all, try to create one (only if detection not stopped) - use ref
        console.log('No WebSocket found, creating new connection...')
        startWebSocket()
      }
    }

    // Continue capturing only if detection is not stopped - use ref for synchronous check
    if (!detectionStoppedRef.current) {
      animationFrameRef.current = requestAnimationFrame(captureFrames)
    } else {
      console.log('🛑 Detection stopped (ref) - not continuing frame capture')
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }

  const drawFaceBoxes = (context, displayWidth, displayHeight, videoWidth, videoHeight, offsetX, offsetY) => {
    // Clear canvas first
    context.clearRect(0, 0, displayWidth, displayHeight)
    
    if (!faceDetections || faceDetections.length === 0) {
      return
    }

    // Calculate scale factor - video is displayed with objectFit: contain
    // So we need to scale based on the actual displayed video area
    const videoAspect = videoWidth / videoHeight
    const displayAspect = displayWidth / displayHeight
    
    let scale
    if (displayAspect > videoAspect) {
      // Display is wider - video fits to height
      scale = displayHeight / videoHeight
    } else {
      // Display is taller - video fits to width
      scale = displayWidth / videoWidth
    }
    
    // Debug logging
    if (faceDetections.length > 0) {
      console.log(`🎨 Drawing ${faceDetections.length} face detection(s)`, {
        displaySize: `${displayWidth}x${displayHeight}`,
        videoSize: `${videoWidth}x${videoHeight}`,
        scale,
        offsetX,
        offsetY
      })
    }

    // Draw face detection boxes on top of video
    faceDetections.forEach((detection, index) => {
      const { x, y, width, height, student_id, recognized } = detection
      
      // Ensure coordinates are valid
      if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
        return
      }
      
      // Scale coordinates to display size
      const boxX = (x * scale) + offsetX
      const boxY = (y * scale) + offsetY
      const boxWidth = width * scale
      const boxHeight = height * scale
      
      // Ensure coordinates are within bounds
      const clampedX = Math.max(0, Math.min(boxX, displayWidth - 1))
      const clampedY = Math.max(0, Math.min(boxY, displayHeight - 1))
      const clampedWidth = Math.min(boxWidth, displayWidth - clampedX)
      const clampedHeight = Math.min(boxHeight, displayHeight - clampedY)
      
      if (recognized && student_id) {
        // Green frame for recognized faces
        context.strokeStyle = '#10b981' // green-500
        context.lineWidth = 3 // Fixed line width for visibility
        context.strokeRect(clampedX, clampedY, clampedWidth, clampedHeight)
        
        // Draw label background - position it above the face box
        const labelPadding = 8
        const labelHeight = 28 // Fixed height for better visibility
        const labelWidth = Math.max(140, (student_id.length * 8) + 20) // Width based on text
        const labelX = clampedX
        const labelY = Math.max(labelHeight + 5, clampedY - 8) // Position above the box with 8px gap
        
        // Ensure label doesn't go off-screen
        const finalLabelX = Math.max(0, Math.min(labelX, displayWidth - labelWidth))
        const finalLabelY = Math.max(labelHeight, labelY)
        
        // Draw label background with rounded corners effect
        context.fillStyle = '#10b981'
        context.fillRect(finalLabelX, finalLabelY - labelHeight, labelWidth, labelHeight)
        
        // Draw student ID text
        const fontSize = 16 // Fixed font size for readability
        context.fillStyle = '#ffffff'
        context.font = `bold ${fontSize}px Arial, sans-serif`
        context.textBaseline = 'middle'
        context.textAlign = 'left'
        
        // Add text shadow for better visibility
        context.shadowColor = 'rgba(0, 0, 0, 0.75)'
        context.shadowBlur = 3
        context.shadowOffsetX = 1
        context.shadowOffsetY = 1
        
        const textY = finalLabelY - labelHeight / 2
        context.fillText(student_id, finalLabelX + labelPadding, textY)
        
        // Reset shadow
        context.shadowColor = 'transparent'
        context.shadowBlur = 0
        context.shadowOffsetX = 0
        context.shadowOffsetY = 0
        
        console.log(`✅ Drew recognized face: ${student_id} at (${clampedX}, ${clampedY}), label at (${finalLabelX}, ${finalLabelY})`)
      } else {
        // Red frame for detected but not recognized faces
        context.strokeStyle = '#ef4444' // red-500
        context.lineWidth = 2 // Fixed line width
        context.strokeRect(clampedX, clampedY, clampedWidth, clampedHeight)
        
        // Draw "Unknown" label - position it above the face box
        const labelPadding = 8
        const labelHeight = 28 // Fixed height
        const labelWidth = 100 // Fixed width for "Unknown"
        const labelX = clampedX
        const labelY = Math.max(labelHeight + 5, clampedY - 8) // Position above the box
        
        // Ensure label doesn't go off-screen
        const finalLabelX = Math.max(0, Math.min(labelX, displayWidth - labelWidth))
        const finalLabelY = Math.max(labelHeight, labelY)
        
        // Draw label background
        context.fillStyle = '#ef4444'
        context.fillRect(finalLabelX, finalLabelY - labelHeight, labelWidth, labelHeight)
        
        // Draw "Unknown" text
        const fontSize = 14 // Fixed font size
        context.fillStyle = '#ffffff'
        context.font = `bold ${fontSize}px Arial, sans-serif`
        context.textBaseline = 'middle'
        context.textAlign = 'left'
        
        // Add text shadow for better visibility
        context.shadowColor = 'rgba(0, 0, 0, 0.75)'
        context.shadowBlur = 3
        context.shadowOffsetX = 1
        context.shadowOffsetY = 1
        
        context.fillText('Unknown', finalLabelX + labelPadding, finalLabelY - labelHeight / 2)
        
        // Reset shadow
        context.shadowColor = 'transparent'
        context.shadowBlur = 0
        context.shadowOffsetX = 0
        context.shadowOffsetY = 0
      }
    })
  }

  const handleRecognitionResult = (data) => {
    // Stop processing if detection was stopped - use ref for synchronous check
    if (detectionStoppedRef.current) {
      console.log('🛑 Detection stopped (ref) - ignoring recognition result')
      return
    }
    
    const { recognized_students, total_faces_detected, total_faces_recognized, face_detections, annotated_frame } = data
    
    setRecognitionStats((prev) => ({
      recognized_students: recognized_students || [],
      total_faces_detected: total_faces_detected || 0,
      total_faces_recognized: total_faces_recognized || 0
    }))

    // Update face detections with actual locations from backend
    if (face_detections && Array.isArray(face_detections)) {
      console.log(`📥 Received ${face_detections.length} face detection(s) from backend:`, face_detections)
      setFaceDetections(face_detections)
    } else {
      console.log('⚠️ No face_detections in response or not an array:', face_detections)
    }


    // Auto-mark attendance for newly recognized students
    if (recognized_students && Array.isArray(recognized_students)) {
      recognized_students.forEach((studentId) => {
        setMarkedStudents((prev) => {
          if (!prev.has(studentId)) {
            console.log(`New student recognized: ${studentId}`)
            return new Set([...prev, studentId])
          }
          return prev
        })
      })
    }
  }

  const handleManualAttendance = async () => {
    if (!selectedClass) {
      toast.error('Please select a class')
      return
    }

    // Get all present students from the attendance state
    // If no students are marked, all will be recorded as absent
    const presentStudents = Object.keys(studentAttendance).filter(
      studentId => studentAttendance[studentId] === 'present'
    )

    try {
      await api.post('/faculty/attendance/manual', {
        class_id: selectedClass.id,
        date: new Date().toISOString(),
        mode: 'manual',
        present_students: presentStudents
      })
      toast.success(`Attendance recorded successfully. ${presentStudents.length} present, ${enrolledStudents.length - presentStudents.length} absent.`)
      setStudentAttendance({})
      setSelectedStudents([])
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to record attendance')
    }
  }

  const toggleStudentAttendance = (studentId) => {
    setStudentAttendance(prev => {
      const currentStatus = prev[studentId]
      if (currentStatus === 'present') {
        // If currently present, mark as absent
        const newState = { ...prev }
        delete newState[studentId]
        return newState
      } else {
        // Mark as present
        return { ...prev, [studentId]: 'present' }
      }
    })
  }

  const markAllPresent = () => {
    const allPresent = {}
    enrolledStudents.forEach(student => {
      allPresent[student.student_id] = 'present'
    })
    setStudentAttendance(allPresent)
  }

  const markAllAbsent = () => {
    setStudentAttendance({})
  }

  const handleAutoAttendance = async () => {
    if (!selectedClass) {
      toast.error('Please select a class')
      return
    }

    // Check if backend is accessible
    try {
      const response = await api.get('/health')
      console.log('Backend health check:', response.data)
    } catch (error) {
      console.error('Backend health check failed:', error)
      toast.error('Cannot connect to backend server. Please ensure it is running on port 8888.')
      return
    }

    setShowCamera(true)
    setMarkedStudents(new Set())
    setValidatedStudents(new Set())
    setDetectionStopped(false)
    detectionStoppedRef.current = false // Reset ref as well
    setRecognitionStats({
      recognized_students: [],
      total_faces_detected: 0,
      total_faces_recognized: 0
    })
    setWsConnected(false)
  }

  const handleStopDetection = async () => {
    detectionStoppedRef.current = true
    setDetectionStopped(true)
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    
    // Send stop message to backend FIRST before closing WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        const stopMessage = JSON.stringify({ action: 'stop' })
        wsRef.current.send(stopMessage)
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (sendError) {
        // Error sending stop message
      }
    }
    
    await stopWebSocket(false)
    stopCamera()
    setValidatedStudents(new Set(markedStudents))
    setFaceDetections([])
    
    toast.info('Face detection stopped. Please validate and submit attendance.')
  }

  const handleSubmitAttendance = async () => {
    console.log('💾 Submit Attendance clicked')
    console.log('   validatedStudents.size:', validatedStudents.size)
    console.log('   validatedStudents:', Array.from(validatedStudents))
    console.log('   selectedClass:', selectedClass)
    console.log('   recognitionStats:', recognitionStats)
    
    if (!selectedClass || !selectedClass.id) {
      console.error('❌ No class selected')
      toast.error('No class selected')
      return
    }

    if (validatedStudents.size === 0) {
      const shouldSave = window.confirm('No students selected. Do you still want to save attendance with 0 students?')
      if (!shouldSave) {
        console.log('User cancelled save with 0 students')
        return
      }
    }

    try {
      const validatedStudentsList = Array.from(validatedStudents)
      const payload = {
        class_id: selectedClass.id,
        recognized_students: validatedStudentsList.length > 0 ? validatedStudentsList : [],
        total_faces_detected: recognitionStats.total_faces_detected || 0,
        total_faces_recognized: recognitionStats.total_faces_recognized || 0,
        timestamp: new Date().toISOString()
      }
      
      console.log('💾 Saving attendance with payload:', JSON.stringify(payload, null, 2))
      console.log('   API endpoint: /faculty/attendance/auto')

      const response = await api.post('/faculty/attendance/auto', payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      })
      
      console.log('✅ Attendance saved successfully:', response.data)
      
      if (response.data && response.data.students_marked > 0) {
        toast.success(
          `Attendance saved! ${response.data.students_marked} students marked present.`
        )
      } else {
        toast.warn('Attendance saved but no students were marked present.')
      }
      
      // Properly close WebSocket before closing modal
      console.log('🔌 Closing WebSocket connection after successful attendance save...')
      stopWebSocket()
      
      // Stop camera
      stopCamera()
      
      // Close modal and reset
      detectionStoppedRef.current = false // Reset ref
      setShowCamera(false)
      setDetectionStopped(false)
      setMarkedStudents(new Set())
      setValidatedStudents(new Set())
      setRecognitionStats({
        recognized_students: [],
        total_faces_detected: 0,
        total_faces_recognized: 0
      })
      setFaceDetections([])
    } catch (error) {
      console.error('❌ Error saving attendance:', error)
      console.error('   Error type:', error.name)
      console.error('   Error message:', error.message)
      console.error('   Error stack:', error.stack)
      if (error.response) {
        console.error('   Response status:', error.response.status)
        console.error('   Response data:', error.response.data)
        console.error('   Response headers:', error.response.headers)
      } else if (error.request) {
        console.error('   Request made but no response received:', error.request)
      }
      
      const errorMessage = error.response?.data?.detail || 
                          error.response?.data?.message || 
                          error.message || 
                          'Failed to save attendance. Please check console for details.'
      toast.error(errorMessage)
    }
  }

  const enrolledStudents = selectedClass?.enrolled_students || []

  return (
    <div className="px-4 py-6">
      <h2 className="text-2xl font-bold mb-6">Take Attendance</h2>

      <div className="bg-white shadow-md rounded-lg p-6 mb-6">
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Class</label>
          <select
            value={selectedClass?.id || ''}
            onChange={(e) => {
              const cls = classes.find((c) => c.id === e.target.value)
              setSelectedClass(cls)
              setSelectedStudents([])
              setStudentAttendance({})
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
            disabled={showCamera}
          >
            <option value="">Select a class</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name} ({cls.code})
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Attendance Mode</label>
          <div className="flex space-x-4">
            <label className="flex items-center">
              <input
                type="radio"
                value="manual"
                checked={mode === 'manual'}
                onChange={(e) => setMode(e.target.value)}
                className="mr-2"
                disabled={showCamera}
              />
              Manual
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="auto"
                checked={mode === 'auto'}
                onChange={(e) => setMode(e.target.value)}
                className="mr-2"
                disabled={showCamera}
              />
              Auto (Face Recognition)
            </label>
          </div>
        </div>

        {mode === 'manual' && selectedClass && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Mark Student Attendance
              </label>
              <div className="flex gap-2">
                <button
                  onClick={markAllPresent}
                  className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1 rounded-md hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                >
                  Mark All Present
                </button>
                <button
                  onClick={markAllAbsent}
                  className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Clear All
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {enrolledStudents.map((student) => {
                  const isPresent = studentAttendance[student.student_id] === 'present'
                  return (
                    <div
                      key={student.student_id}
                      className={`flex items-center justify-between p-3 rounded-lg border-2 transition-all cursor-pointer ${
                        isPresent
                          ? 'bg-green-50 dark:bg-green-900/20 border-green-500 dark:border-green-600'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                      onClick={() => toggleStudentAttendance(student.student_id)}
                    >
                      <div className="flex items-center space-x-3 flex-1">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          isPresent
                            ? 'bg-green-500 border-green-500'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}>
                          {isPresent && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {student.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {student.student_id}
                          </p>
                        </div>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-1 rounded ${
                        isPresent
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}>
                        {isPresent ? 'Present' : 'Absent'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-medium text-green-600 dark:text-green-400">
                  {Object.values(studentAttendance).filter(status => status === 'present').length}
                </span> present out of {enrolledStudents.length} students
              </div>
              <button
                onClick={handleManualAttendance}
                className="bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-2 rounded-lg hover:from-green-600 hover:to-green-700 transition-all duration-200 shadow-md hover:shadow-lg font-medium"
              >
                Record Attendance
              </button>
            </div>
          </div>
        )}

        {mode === 'auto' && selectedClass && !showCamera && (
          <div>
            <button
              onClick={handleAutoAttendance}
              className="bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600"
            >
              Start Auto Attendance
            </button>
          </div>
        )}
      </div>

      {/* Auto Attendance Console */}
      {showCamera && mode === 'auto' && (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-5xl w-full mx-4">
            <h3 className="text-2xl font-bold mb-4">Attendance Capture Console - {selectedClass?.name}</h3>
            
            {!detectionStopped ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                {/* Video Feed */}
                <div className="lg:col-span-2">
                    <div className="mb-2 flex justify-between items-center">
                      <div className="text-xs text-gray-500">
                        {faceDetections.length > 0 ? `${faceDetections.length} face(s) detected` : 'Waiting for face detection...'}
                        <span className="ml-2">
                          {wsConnected ? (
                            <span className="text-green-600">● WebSocket Connected</span>
                          ) : wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING ? (
                            <span className="text-yellow-600">● Connecting...</span>
                          ) : (
                            <span className="text-red-600">● WebSocket Disconnected</span>
                          )}
                        </span>
                        {isStreaming && (
                          <span className="ml-2 text-blue-600">● Camera Active</span>
                        )}
                      </div>
                    </div>
                  
                  {/* Live Camera Feed */}
                  <div 
                    ref={(el) => { if (el) videoContainerRef.current = el }}
                    className="relative bg-black rounded-md overflow-hidden mb-2" 
                    style={{ position: 'relative', width: '100%' }}
                  >
                    <video
                      ref={videoRef}
                      className="w-full h-auto"
                      autoPlay
                      playsInline
                      muted
                      style={{ display: 'block', width: '100%', maxHeight: '600px', objectFit: 'contain' }}
                    />
                    <canvas
                      ref={canvasRef}
                      style={{ 
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        pointerEvents: 'none',
                        zIndex: 10,
                        width: '100%',
                        height: '100%'
                      }}
                    />
                  </div>
                </div>

                {/* Stats Panel */}
                <div className="bg-gray-50 rounded-md p-4">
                  <h4 className="font-semibold mb-3">Recognition Stats</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Faces Detected:</span>
                      <span className="font-bold">{recognitionStats.total_faces_detected}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Faces Recognized:</span>
                      <span className="font-bold text-green-600">{recognitionStats.total_faces_recognized}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Marked Present:</span>
                      <span className="font-bold text-blue-600">{markedStudents.size}</span>
                    </div>
                  </div>

                  {recognitionStats.recognized_students.length > 0 && (
                    <div className="mt-4">
                      <h5 className="font-semibold text-sm mb-2">Recognized Students:</h5>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {Array.from(markedStudents).map((studentId) => (
                          <div key={studentId} className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                            ✓ {studentId}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 p-3 bg-blue-50 rounded-md">
                    <p className="text-xs text-blue-800">
                      <strong>Note:</strong> Recognized faces are highlighted with green frames. 
                      Click "Stop Detection" to validate and submit attendance.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
                  <h4 className="font-semibold mb-2 text-green-800">Detection Summary</h4>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Faces Detected:</span>
                      <span className="ml-2 font-bold">{recognitionStats.total_faces_detected}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Faces Recognized:</span>
                      <span className="ml-2 font-bold text-green-600">{recognitionStats.total_faces_recognized}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Students Recognized:</span>
                      <span className="ml-2 font-bold text-blue-600">{markedStudents.size}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Validation Panel - Show after detection is stopped */}
            {detectionStopped && (
              <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                <h4 className="font-semibold mb-3 text-yellow-800">Validate Attendance</h4>
                <p className="text-sm text-yellow-700 mb-3">
                  Review and adjust the list of students to mark as present:
                </p>
                <div className="max-h-60 overflow-y-auto border border-gray-300 rounded-md p-3 bg-white">
                  {enrolledStudents.length === 0 ? (
                    <p className="text-sm text-gray-500">No students enrolled in this class.</p>
                  ) : (
                    enrolledStudents.map((student) => {
                      const isSelected = validatedStudents.has(student.student_id)
                      const wasRecognized = markedStudents.has(student.student_id)
                      return (
                        <label key={student.student_id} className="flex items-center mb-2 p-2 hover:bg-gray-50 rounded">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setValidatedStudents(new Set([...validatedStudents, student.student_id]))
                              } else {
                                const newSet = new Set(validatedStudents)
                                newSet.delete(student.student_id)
                                setValidatedStudents(newSet)
                              }
                            }}
                            className="mr-3"
                          />
                          <div className="flex-1">
                            <span className="text-sm font-medium">{student.name}</span>
                            <span className="text-xs text-gray-500 ml-2">({student.student_id})</span>
                            {wasRecognized && (
                              <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                                ✓ Recognized
                              </span>
                            )}
                          </div>
                        </label>
                      )
                    })
                  )}
                </div>
                <div className="mt-3 text-sm text-gray-600">
                  <span className="font-medium">Selected: {validatedStudents.size}</span>
                  <span className="ml-4">Recognized: {markedStudents.size}</span>
                  <span className="ml-4">Total Enrolled: {enrolledStudents.length}</span>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  detectionStoppedRef.current = false // Reset ref
                  stopCamera()
                  stopWebSocket()
                  setShowCamera(false)
                  setDetectionStopped(false)
                  setMarkedStudents(new Set())
                  setValidatedStudents(new Set())
                  setRecognitionStats({
                    recognized_students: [],
                    total_faces_detected: 0,
                    total_faces_recognized: 0
                  })
                  setFaceDetections([])
                }}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              {!detectionStopped ? (
              <button
                  onClick={handleStopDetection}
                  className="px-6 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600"
              >
                  Stop Detection
              </button>
              ) : (
                <button
                  onClick={handleSubmitAttendance}
                  className="px-6 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
                >
                  Submit Attendance ({validatedStudents.size})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Attendance
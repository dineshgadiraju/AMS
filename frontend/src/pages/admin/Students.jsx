import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-toastify'
import api from '../../services/api'

function Students() {
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    primary_mobile: ''
  })
  // Stores captured images as data URLs
  const [faceImages, setFaceImages] = useState([])
  const [defaultImageCount] = useState(25) // Default number of images
  const [additionalImageCount, setAdditionalImageCount] = useState(0)
  const [isCapturing, setIsCapturing] = useState(false)
  const [isAutoCapturing, setIsAutoCapturing] = useState(false)
  const [isTraining, setIsTraining] = useState(false)
  const [trainingProgress, setTrainingProgress] = useState(0)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const captureIntervalRef = useRef(null)

  useEffect(() => {
    fetchStudents()
  }, [])

  useEffect(() => {
    if (showAddModal) {
      startCamera()
    } else {
      stopCamera()
      setFaceImages([])
      setIsCapturing(false)
      setIsAutoCapturing(false)
      setAdditionalImageCount(0)
      setTrainingProgress(0)
      setIsTraining(false)
    }
  }, [showAddModal])

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error('Camera not supported in this browser')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        streamRef.current = stream
        setIsCapturing(true)
      }
    } catch (error) {
      console.error(error)
      toast.error('Unable to access camera')
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current)
      captureIntervalRef.current = null
    }
  }

  const captureSingleImage = () => {
    if (!videoRef.current || !canvasRef.current) return null

    const video = videoRef.current
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    return canvas.toDataURL('image/jpeg')
  }

  const handleAutoCapture = () => {
    if (!isCapturing) {
      toast.error('Camera not ready')
      return
    }

    setIsAutoCapturing(true)
    const targetCount = defaultImageCount
    let captured = 0

    // Capture images with delay between each
    captureIntervalRef.current = setInterval(() => {
      const dataUrl = captureSingleImage()
      if (dataUrl) {
        setFaceImages((prev) => [...prev, dataUrl])
        captured++
        
        if (captured >= targetCount) {
          clearInterval(captureIntervalRef.current)
          captureIntervalRef.current = null
          setIsAutoCapturing(false)
          toast.success(`Captured ${targetCount} images successfully!`)
        }
      }
    }, 300) // 300ms delay between captures
  }

  const handleAddMoreImages = () => {
    if (!isCapturing) {
      toast.error('Camera not ready')
      return
    }

    if (additionalImageCount <= 0) {
      toast.error('Please enter number of additional images')
      return
    }

    setIsAutoCapturing(true)
    const targetCount = faceImages.length + additionalImageCount
    let captured = faceImages.length

    // Capture additional images
    captureIntervalRef.current = setInterval(() => {
      const dataUrl = captureSingleImage()
      if (dataUrl) {
        setFaceImages((prev) => [...prev, dataUrl])
        captured++
        
        if (captured >= targetCount) {
          clearInterval(captureIntervalRef.current)
          captureIntervalRef.current = null
          setIsAutoCapturing(false)
          setAdditionalImageCount(0)
          toast.success(`Added ${additionalImageCount} more images!`)
        }
      }
    }, 300)
  }

  const dataUrlToBlob = (dataUrl) => {
    const arr = dataUrl.split(',')
    const mimeMatch = arr[0].match(/:(.*?);/)
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }
    return new Blob([u8arr], { type: mime })
  }

  const fetchStudents = async () => {
    try {
      const response = await api.get('/admin/students')
      setStudents(response.data)
    } catch (error) {
      toast.error('Failed to fetch students')
    } finally {
      setLoading(false)
    }
  }

  const handleAddStudent = async (e) => {
    e.preventDefault()
    
    // Validate form
    if (!formData.full_name || !formData.email || !formData.primary_mobile || !formData.password) {
      toast.error('Please fill all required fields')
      return
    }

    if (faceImages.length === 0) {
      toast.error('Please capture at least one image')
      return
    }

    setIsTraining(true)
    setTrainingProgress(0)

    // Step 1: Register student (0-30%)
    try {
      const studentResponse = await api.post('/admin/students', formData)
      const studentId = studentResponse.data.student_id
      setTrainingProgress(30)

      // Step 2: Train images (30-100%)
      const progressInterval = setInterval(() => {
        setTrainingProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval)
            return 90
          }
          return prev + 5
        })
      }, 200)

      // Prepare images for upload
      const formDataUpload = new FormData()
      faceImages.forEach((dataUrl, index) => {
        const blob = dataUrlToBlob(dataUrl)
        formDataUpload.append('images', blob, `capture_${index + 1}.jpg`)
      })

      // Upload and train face data
      const trainingResponse = await api.post(`/admin/students/${studentId}/face-data`, formDataUpload)
      
      clearInterval(progressInterval)
      setTrainingProgress(100)

      setTimeout(() => {
        toast.success(
          `Student added and trained successfully! ${trainingResponse.data.faces_detected} faces detected from ${trainingResponse.data.total_images} images.`
        )
        setShowAddModal(false)
        setFormData({ email: '', password: '', full_name: '', primary_mobile: '' })
        setFaceImages([])
        setAdditionalImageCount(0)
        setTrainingProgress(0)
        setIsTraining(false)
        stopCamera()
        fetchStudents()
      }, 500)
    } catch (error) {
      setTrainingProgress(0)
      setIsTraining(false)
      toast.error(error.response?.data?.detail || 'Failed to add student or train images')
    }
  }

  const toggleStudentStatus = async (studentId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
    try {
      await api.put(`/admin/students/${studentId}/status`, null, {
        params: { new_status: newStatus }
      })
      toast.success(`Student ${newStatus}`)
      fetchStudents()
    } catch (error) {
      toast.error('Failed to update status')
    }
  }

  const handleDeleteStudent = async (studentId, studentName) => {
    if (!window.confirm(`Are you sure you want to delete student "${studentName}" (${studentId})? This action cannot be undone.`)) {
      return
    }

    try {
      await api.delete(`/admin/students/${studentId}`)
      toast.success('Student deleted successfully')
      fetchStudents()
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete student')
    }
  }

  if (loading) return <div>Loading...</div>

  return (
    <div className="px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Students</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Manage student accounts and face recognition data</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-3 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl font-medium flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Student</span>
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow-lg rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Student ID</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Name</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Email</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Mobile</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {students.map((student) => (
              <tr key={student.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{student.student_id}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{student.full_name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{student.email}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{student.primary_mobile}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                    student.status === 'active' 
                      ? 'bg-green-100 text-green-800 border border-green-200' 
                      : 'bg-red-100 text-red-800 border border-red-200'
                  }`}>
                    {student.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => toggleStudentStatus(student.student_id, student.status)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                        student.status === 'active' 
                          ? 'bg-red-50 text-red-600 hover:bg-red-100' 
                          : 'bg-green-50 text-green-600 hover:bg-green-100'
                      }`}
                    >
                      {student.status === 'active' ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => handleDeleteStudent(student.student_id, student.full_name)}
                      className="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-md text-xs font-medium transition-colors"
                      title="Delete student"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Combined Add Student + Image Capture Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center z-50 overflow-y-auto backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl w-full max-w-5xl my-8 shadow-2xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Add New Student
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false)
                  setFormData({ email: '', password: '', full_name: '', primary_mobile: '' })
                  setFaceImages([])
                  setAdditionalImageCount(0)
                  setTrainingProgress(0)
                  setIsTraining(false)
                  stopCamera()
                }}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <form onSubmit={handleAddStudent}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column: Student Details Form */}
                <div>
                  <h4 className="text-lg font-semibold mb-4">Student Information</h4>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      value={formData.full_name}
                      onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md"
                      required
                      disabled={isTraining}
                    />
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md"
                      required
                      disabled={isTraining}
                    />
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Primary Mobile *</label>
                    <input
                      type="tel"
                      value={formData.primary_mobile}
                      onChange={(e) => setFormData({ ...formData, primary_mobile: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md"
                      required
                      disabled={isTraining}
                    />
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md"
                      required
                      disabled={isTraining}
                    />
                  </div>
                </div>

                {/* Right Column: Image Capture */}
                <div>
                  <h4 className="text-lg font-semibold mb-4">Face Image Capture</h4>
                  
                  {/* Camera View */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Live Camera</label>
                    <div className="relative bg-black rounded-md overflow-hidden">
                      <video
                        ref={videoRef}
                        className="w-full h-64 object-cover bg-black"
                        autoPlay
                        playsInline
                        muted
                      />
                      <canvas ref={canvasRef} className="hidden" />
                    </div>
                  </div>

                  {/* Capture Controls */}
                  <div className="mb-4 space-y-3">
                    <button
                      type="button"
                      onClick={handleAutoCapture}
                      disabled={!isCapturing || isAutoCapturing || isTraining || faceImages.length >= defaultImageCount}
                      className="w-full px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isAutoCapturing ? `Capturing... (${faceImages.length}/${defaultImageCount})` : `Capture ${defaultImageCount} Images`}
                    </button>

                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={additionalImageCount}
                        onChange={(e) => setAdditionalImageCount(Number(e.target.value) || 0)}
                        placeholder="Additional images"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                        disabled={isAutoCapturing || isTraining}
                      />
                      <button
                        type="button"
                        onClick={handleAddMoreImages}
                        disabled={!isCapturing || isAutoCapturing || isTraining || additionalImageCount <= 0}
                        className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                      >
                        Add More
                      </button>
                    </div>
                  </div>

                  {/* Captured Images Display */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Captured Photos ({faceImages.length})
                    </label>
                    {faceImages.length === 0 ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-600 rounded-md p-4 text-center">
                        No photos captured yet. Click "Capture {defaultImageCount} Images" to start.
                      </p>
                    ) : (
                      <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-md p-2">
                        {faceImages.map((img, idx) => (
                          <div key={idx} className="relative">
                            <img
                              src={img}
                              alt={`Capture ${idx + 1}`}
                              className="w-full h-16 object-cover rounded-md border border-gray-200 dark:border-gray-600"
                            />
                            <span className="absolute top-0 right-0 bg-black bg-opacity-50 text-white text-xs px-1 rounded">
                              {idx + 1}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              {isTraining && (
                <div className="mt-6 mb-4">
                  <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Processing: Registering student and training images...</span>
                    <span className="text-sm text-gray-600 dark:text-gray-400">{trainingProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${trainingProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end space-x-2 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false)
                    setFormData({ email: '', password: '', full_name: '', primary_mobile: '' })
                    setFaceImages([])
                    setAdditionalImageCount(0)
                    setTrainingProgress(0)
                    setIsTraining(false)
                    stopCamera()
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md"
                  disabled={isTraining}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isTraining || faceImages.length === 0}
                >
                  {isTraining ? 'Processing...' : 'Add Student & Train'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Students
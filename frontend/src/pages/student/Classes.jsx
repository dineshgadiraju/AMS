import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import api from '../../services/api'

function Classes() {
  const [availableClasses, setAvailableClasses] = useState([])
  const [enrolledClasses, setEnrolledClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('available')

  useEffect(() => {
    fetchAvailableClasses()
    fetchEnrolledClasses()
  }, [])

  const fetchAvailableClasses = async () => {
    try {
      const response = await api.get('/student/classes/available')
      setAvailableClasses(response.data)
    } catch (error) {
      toast.error('Failed to fetch available classes')
    } finally {
      setLoading(false)
    }
  }

  const fetchEnrolledClasses = async () => {
    try {
      const response = await api.get('/student/classes/enrolled')
      setEnrolledClasses(response.data)
    } catch (error) {
      toast.error('Failed to fetch enrolled classes')
    }
  }

  const handleEnroll = async (classId) => {
    try {
      await api.post(`/student/classes/${classId}/enroll`)
      toast.success('Enrolled successfully')
      fetchAvailableClasses()
      fetchEnrolledClasses()
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to enroll')
    }
  }

  if (loading) return <div>Loading...</div>

  return (
    <div className="px-4 py-6">
      <h2 className="text-2xl font-bold mb-6">Classes</h2>
      
      <div className="mb-4">
        <div className="flex space-x-4 border-b">
          <button
            onClick={() => setActiveTab('available')}
            className={`px-4 py-2 ${
              activeTab === 'available'
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-600'
            }`}
          >
            Available Classes
          </button>
          <button
            onClick={() => setActiveTab('enrolled')}
            className={`px-4 py-2 ${
              activeTab === 'enrolled'
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-600'
            }`}
          >
            Enrolled Classes
          </button>
        </div>
      </div>

      {activeTab === 'available' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {availableClasses.map((cls) => (
            <div key={cls.id} className="bg-white shadow-md rounded-lg p-6">
              <h3 className="text-xl font-bold mb-2">{cls.name}</h3>
              <p className="text-gray-600 mb-2">Code: {cls.code}</p>
              <p className="text-gray-600 mb-2">Faculty: {cls.faculty_name}</p>
              <p className="text-sm text-gray-500 mb-4">{cls.description}</p>
              {!cls.is_enrolled ? (
                <button
                  onClick={() => handleEnroll(cls.id)}
                  className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
                >
                  Enroll
                </button>
              ) : (
                <span className="text-green-600 font-semibold">Enrolled</span>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'enrolled' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {enrolledClasses.map((cls) => (
            <div key={cls.id} className="bg-white shadow-md rounded-lg p-6">
              <h3 className="text-xl font-bold mb-2">{cls.name}</h3>
              <p className="text-gray-600 mb-2">Code: {cls.code}</p>
              <p className="text-gray-600 mb-2">Faculty: {cls.faculty_name}</p>
              <div className="mt-4">
                <p className="text-sm text-gray-600">
                  Attendance: {cls.attendance_percentage}%
                </p>
                <p className="text-sm text-gray-600">
                  Present: {cls.present_count} / {cls.total_classes}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Classes
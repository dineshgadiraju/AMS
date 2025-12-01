import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import api from '../../services/api'

function Classes() {
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchClasses()
  }, [])

  const fetchClasses = async () => {
    try {
      const response = await api.get('/faculty/classes')
      setClasses(response.data)
    } catch (error) {
      toast.error('Failed to fetch classes')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div>Loading...</div>

  return (
    <div className="px-4 py-6">
      <h2 className="text-2xl font-bold mb-6">My Classes</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {classes.map((cls) => (
          <div key={cls.id} className="bg-white shadow-md rounded-lg p-6">
            <h3 className="text-xl font-bold mb-2">{cls.name}</h3>
            <p className="text-gray-600 mb-2">Code: {cls.code}</p>
            <p className="text-gray-600 mb-4">Enrolled Students: {cls.enrolled_students.length}</p>
            <div className="mt-4">
              <h4 className="font-semibold mb-2">Students:</h4>
              <div className="space-y-2">
                {cls.enrolled_students.map((student) => (
                  <div key={student.student_id} className="flex justify-between text-sm">
                    <span>{student.name}</span>
                    <span className="text-gray-600">{student.attendance_percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Classes
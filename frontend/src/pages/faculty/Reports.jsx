import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import api from '../../services/api'

function Reports() {
  const [reports, setReports] = useState([])
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedClass, setSelectedClass] = useState('all')
  const [attendanceMode, setAttendanceMode] = useState('all')

  useEffect(() => {
    fetchClasses()
    fetchReports()
  }, [])

  const fetchClasses = async () => {
    try {
      const response = await api.get('/faculty/classes')
      setClasses(response.data)
    } catch (error) {
      toast.error('Failed to fetch classes')
    }
  }

  const fetchReports = async () => {
    try {
      setLoading(true)
      const params = {}
      if (selectedClass && selectedClass !== 'all') {
        params.class_id = selectedClass
      }
      if (startDate) {
        params.start_date = new Date(startDate).toISOString()
      }
      if (endDate) {
        params.end_date = new Date(endDate + 'T23:59:59').toISOString()
      }
      if (attendanceMode && attendanceMode !== 'all') {
        params.mode = attendanceMode
      }
      const response = await api.get('/faculty/reports', { params })
      setReports(response.data)
    } catch (error) {
      toast.error('Failed to fetch reports')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async (classId = null) => {
    try {
      const params = { format: 'csv' }
      if (classId) {
        params.class_id = classId
      } else if (selectedClass && selectedClass !== 'all') {
        params.class_id = selectedClass
      }
      if (startDate) {
        params.start_date = new Date(startDate).toISOString()
      }
      if (endDate) {
        params.end_date = new Date(endDate + 'T23:59:59').toISOString()
      }
      if (attendanceMode && attendanceMode !== 'all') {
        params.mode = attendanceMode
      }
      const response = await api.get('/faculty/reports/download', {
        params,
        responseType: 'blob'
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      const filename = classId 
        ? `attendance_report_${reports.find(r => r.class_id === classId)?.class_name || classId}.csv`
        : selectedClass && selectedClass !== 'all'
        ? `attendance_report_${classes.find(c => c.id === selectedClass)?.name || 'class'}.csv`
        : 'attendance_report_all_classes.csv'
      link.setAttribute('download', filename)
      document.body.appendChild(link)
      link.click()
      link.remove()
      toast.success('Report downloaded successfully')
    } catch (error) {
      toast.error('Failed to download report')
    }
  }

  const handleFilter = () => {
    fetchReports()
  }

  const handleClearFilter = () => {
    setStartDate('')
    setEndDate('')
    setSelectedClass('all')
    setAttendanceMode('all')
    fetchReports()
  }

  if (loading) return <div>Loading...</div>

  return (
    <div className="px-4 py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Attendance Reports</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">View and download attendance statistics for your classes</p>
        </div>
        <button
          onClick={() => handleDownload()}
          className="bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-3 rounded-lg hover:from-green-600 hover:to-green-700 transition-all duration-200 shadow-lg hover:shadow-xl font-medium flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Download All</span>
        </button>
      </div>

      {/* Filter Section */}
      <div className="bg-white dark:bg-gray-800 shadow-lg rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Class
            </label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">All Classes</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name} ({cls.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Attendance Type
            </label>
            <select
              value={attendanceMode}
              onChange={(e) => setAttendanceMode(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">All Types</option>
              <option value="auto">Auto (Face Recognition)</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleFilter}
            className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded-lg transition-colors duration-200 font-medium"
          >
            Apply Filter
          </button>
          <button
            onClick={handleClearFilter}
            className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-2 rounded-lg transition-colors duration-200 font-medium"
          >
            Clear All
          </button>
        </div>
        {(startDate || endDate || (selectedClass && selectedClass !== 'all') || (attendanceMode && attendanceMode !== 'all')) && (
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium">Active filters: </span>
            <span className="flex flex-wrap gap-2 mt-1">
              {selectedClass && selectedClass !== 'all' && (
                <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded">
                  Class: {classes.find(c => c.id === selectedClass)?.name || selectedClass}
                </span>
              )}
              {attendanceMode && attendanceMode !== 'all' && (
                <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded">
                  Type: {attendanceMode === 'auto' ? 'Auto' : 'Manual'}
                </span>
              )}
              {startDate && (
                <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded">
                  From: {new Date(startDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
              )}
              {endDate && (
                <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded">
                  To: {new Date(endDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
      <div className="space-y-6">
        {reports.map((report) => (
          <div key={report.class_id} className="bg-white dark:bg-gray-800 shadow-lg rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{report.class_name}</h3>
                <div className="mt-2">
                  <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-3 py-1 rounded-full text-sm font-semibold">
                    {report.students.length} Students
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleDownload(report.class_id)}
                className="bg-gradient-to-r from-green-500 to-green-600 text-white px-4 py-2 rounded-lg hover:from-green-600 hover:to-green-700 transition-all duration-200 shadow-md hover:shadow-lg font-medium flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Download</span>
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Student ID</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Total Classes</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Present</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Percentage</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {report.students.map((student) => (
                    <tr key={student.student_id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{student.student_id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{student.student_name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{student.total_classes}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="bg-green-100 text-green-800 px-2 py-1 rounded-md text-xs font-semibold">
                          {student.present_count}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          student.attendance_percentage >= 75 
                            ? 'bg-green-100 text-green-800' 
                            : student.attendance_percentage >= 50 
                            ? 'bg-yellow-100 text-yellow-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {student.attendance_percentage}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Reports
import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import api from '../../services/api'
import { format, parseISO } from 'date-fns'

function Attendance() {
  const [attendanceRecords, setAttendanceRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterClass, setFilterClass] = useState('all')
  const [filterMode, setFilterMode] = useState('all')
  const [classes, setClasses] = useState([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    fetchAttendance()
    fetchClasses()
  }, [])

  const fetchClasses = async () => {
    try {
      const response = await api.get('/student/classes/enrolled')
      setClasses(response.data)
    } catch (error) {
      console.error('Failed to fetch classes')
    }
  }

  const fetchAttendance = async () => {
    try {
      setLoading(true)
      const params = {}
      if (startDate) {
        params.start_date = new Date(startDate).toISOString()
      }
      if (endDate) {
        params.end_date = new Date(endDate + 'T23:59:59').toISOString()
      }
      const response = await api.get('/student/attendance/reports', { params })
      setAttendanceRecords(response.data)
    } catch (error) {
      toast.error('Failed to fetch attendance records')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    try {
      const classId = filterClass !== 'all' ? filterClass : null
      const params = { 
        class_id: classId,
        format: 'csv' 
      }
      if (startDate) {
        params.start_date = new Date(startDate).toISOString()
      }
      if (endDate) {
        params.end_date = new Date(endDate + 'T23:59:59').toISOString()
      }
      const response = await api.get('/student/attendance/reports/download', {
        params,
        responseType: 'blob'
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      const filename = classId 
        ? `attendance_${classes.find(c => c.id === classId)?.name || 'report'}.csv`
        : 'my_attendance_report.csv'
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
    fetchAttendance()
  }

  const handleClearFilter = () => {
    setStartDate('')
    setEndDate('')
    fetchAttendance()
  }

  const formatDateTime = (dateString) => {
    try {
      const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString)
      return {
        date: format(date, 'MMM dd, yyyy'),
        time: format(date, 'hh:mm a')
      }
    } catch (error) {
      return {
        date: new Date(dateString).toLocaleDateString(),
        time: new Date(dateString).toLocaleTimeString()
      }
    }
  }

  const filteredRecords = attendanceRecords.filter(record => {
    const classMatch = filterClass === 'all' || record.class_id === filterClass
    const modeMatch = filterMode === 'all' || record.mode === filterMode
    return classMatch && modeMatch
  })

  // Group records by date
  const groupedRecords = filteredRecords.reduce((acc, record) => {
    const dateKey = formatDateTime(record.date || record.timestamp).date
    if (!acc[dateKey]) {
      acc[dateKey] = []
    }
    acc[dateKey].push(record)
    return acc
  }, {})

  const sortedDates = Object.keys(groupedRecords).sort((a, b) => {
    return new Date(b) - new Date(a)
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading attendance records...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">My Attendance</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">View and manage your attendance records</p>
        </div>
        <button
          onClick={handleDownload}
          className="bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-3 rounded-lg hover:from-green-600 hover:to-green-700 transition-all duration-200 shadow-lg hover:shadow-xl font-medium flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Download Report</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Filter by Class</label>
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            >
              <option value="all">All Classes</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Filter by Mode</label>
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            >
              <option value="all">All Modes</option>
              <option value="auto">Auto (Face Recognition)</option>
              <option value="manual">Manual</option>
            </select>
          </div>
        </div>
        
        {/* Date Filter */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Filter by Date Range</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleFilter}
              className="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-2 rounded-lg transition-colors duration-200 font-medium"
            >
              Apply Date Filter
            </button>
            <button
              onClick={handleClearFilter}
              className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-2 rounded-lg transition-colors duration-200 font-medium"
            >
              Clear Date Filter
            </button>
          </div>
          {(startDate || endDate) && (
            <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              <span className="font-medium">Active date filter: </span>
              {startDate && endDate 
                ? `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`
                : startDate 
                ? `From ${new Date(startDate).toLocaleDateString()}`
                : `Until ${new Date(endDate).toLocaleDateString()}`
              }
            </div>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-indigo-100 text-sm font-medium mb-1">Total Records</p>
              <p className="text-3xl font-bold">{filteredRecords.length}</p>
            </div>
            <svg className="w-10 h-10 text-indigo-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
        </div>
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm font-medium mb-1">Auto Mode</p>
              <p className="text-3xl font-bold">
                {filteredRecords.filter(r => r.mode === 'auto').length}
              </p>
            </div>
            <svg className="w-10 h-10 text-purple-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
        </div>
        <div className="bg-gradient-to-br from-pink-500 to-pink-600 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-pink-100 text-sm font-medium mb-1">Manual Mode</p>
              <p className="text-3xl font-bold">
                {filteredRecords.filter(r => r.mode === 'manual').length}
              </p>
            </div>
            <svg className="w-10 h-10 text-pink-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Attendance Records */}
      {sortedDates.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-12 text-center border border-gray-200 dark:border-gray-700">
            <svg className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No Attendance Records</h3>
            <p className="text-gray-600 dark:text-gray-400">No attendance records found for the selected filters.</p>
          </div>
      ) : (
        <div className="space-y-6">
          {sortedDates.map((dateKey) => (
            <div key={dateKey} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center space-x-2">
                  <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>{dateKey}</span>
                  <span className="text-sm font-normal text-gray-600 dark:text-gray-400">
                    ({groupedRecords[dateKey].length} record{groupedRecords[dateKey].length !== 1 ? 's' : ''})
                  </span>
                </h3>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {groupedRecords[dateKey]
                  .sort((a, b) => {
                    const timeA = formatDateTime(a.timestamp || a.date).time
                    const timeB = formatDateTime(b.timestamp || b.date).time
                    return timeB.localeCompare(timeA)
                  })
                  .map((record) => {
                    const { date, time } = formatDateTime(record.timestamp || record.date)
                    return (
                      <div key={record.id} className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <h4 className="text-lg font-semibold text-gray-900 dark:text-white">{record.class_name}</h4>
                              <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                                record.mode === 'auto' 
                                  ? 'bg-green-100 text-green-800 border border-green-200' 
                                  : 'bg-blue-100 text-blue-800 border border-blue-200'
                              }`}>
                                {record.mode === 'auto' ? '🤖 Auto' : '✋ Manual'}
                              </span>
                              <span className="px-3 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                                ✓ Present
                              </span>
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400">
                              <div className="flex items-center space-x-1">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="font-medium">{time}</span>
                              </div>
                              <div className="flex items-center space-x-1">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span>{date}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Attendance
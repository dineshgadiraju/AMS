import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import { QRCodeSVG } from 'qrcode.react'
import api from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

function Profile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [showQR, setShowQR] = useState(false)
  const [formData, setFormData] = useState({
    secondary_mobile: '',
    address: ''
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    try {
      const response = await api.get('/student/profile')
      if (response.data) {
        setProfile(response.data)
        setFormData({
          secondary_mobile: response.data.secondary_mobile || '',
          address: response.data.address || ''
        })
      } else {
        toast.error('Profile data not found')
      }
    } catch (error) {
      console.error('Profile fetch error:', error)
      toast.error(error.response?.data?.detail || 'Failed to fetch profile')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async (e) => {
    e.preventDefault()
    try {
      await api.put('/student/profile', formData)
      toast.success('Profile updated successfully')
      fetchProfile()
    } catch (error) {
      toast.error('Failed to update profile')
    }
  }

  const fetchQRCode = async () => {
    try {
      const response = await api.get('/student/qr-code')
      setShowQR(true)
    } catch (error) {
      toast.error('Failed to fetch QR code')
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-600">Loading profile...</div>
        </div>
      </div>
    )
  }
  
  if (!profile) {
    return (
      <div className="px-4 py-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-xl font-bold text-red-800 mb-2">Profile Not Found</h2>
          <p className="text-red-600">Unable to load your profile. Please try refreshing the page.</p>
          <button
            onClick={fetchProfile}
            className="mt-4 bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6">
      <h2 className="text-2xl font-bold mb-6">My Profile</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white shadow-md rounded-lg p-6">
          <h3 className="text-xl font-bold mb-4">Profile Information</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Student ID</label>
              <p className="mt-1 text-gray-900">{profile.student_id}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Full Name</label>
              <p className="mt-1 text-gray-900">{profile.full_name}</p>
              <p className="text-xs text-gray-500">Cannot be changed</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <p className="mt-1 text-gray-900">{profile.email}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Primary Mobile</label>
              <p className="mt-1 text-gray-900">{profile.primary_mobile}</p>
              <p className="text-xs text-gray-500">Cannot be changed</p>
            </div>
          </div>

          <div className="mt-6">
            <button
              onClick={fetchQRCode}
              className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
            >
              Show QR Code
            </button>
          </div>
        </div>

        <div className="bg-white shadow-md rounded-lg p-6">
          <h3 className="text-xl font-bold mb-4">Update Profile</h3>
          <form onSubmit={handleUpdate}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Secondary Mobile</label>
              <input
                type="tel"
                value={formData.secondary_mobile}
                onChange={(e) => setFormData({ ...formData, secondary_mobile: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <textarea
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                rows="4"
              />
            </div>
            <button
              type="submit"
              className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
            >
              Update Profile
            </button>
          </form>
        </div>
      </div>

      {showQR && profile.student_id && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg">
            <h3 className="text-xl font-bold mb-4">Student QR Code</h3>
            <div className="flex justify-center mb-4">
              <QRCodeSVG value={profile.student_id} size={256} />
            </div>
            <p className="text-center text-gray-600 mb-4">Student ID: {profile.student_id}</p>
            <button
              onClick={() => setShowQR(false)}
              className="w-full bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Profile
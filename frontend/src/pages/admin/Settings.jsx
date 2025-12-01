import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import api from '../../services/api'

function Settings() {
  const [faceImagesCount, setFaceImagesCount] = useState(25)
  const [loading, setLoading] = useState(false)

  const handleUpdate = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.put('/admin/settings/face-images-count', null, {
        params: { count: faceImagesCount }
      })
      toast.success('Settings updated successfully')
    } catch (error) {
      toast.error('Failed to update settings')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 py-6">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>
      <div className="bg-white shadow-md rounded-lg p-6 max-w-md">
        <form onSubmit={handleUpdate}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Face Images Count (Default: 25)
            </label>
            <input
              type="number"
              min="1"
              value={faceImagesCount}
              onChange={(e) => setFaceImagesCount(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            />
            <p className="mt-1 text-sm text-gray-500">
              Number of images to capture during student registration
            </p>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Updating...' : 'Update Settings'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Settings
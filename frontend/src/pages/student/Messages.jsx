import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-toastify'
import api from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import ReactQuill from 'react-quill'
import 'react-quill/dist/quill.snow.css'

function Messages() {
  const { user } = useAuth()
  const { theme } = useTheme()
  const [threads, setThreads] = useState([])
  const [selectedThread, setSelectedThread] = useState(null)
  const [threadMessages, setThreadMessages] = useState([])
  const [showComposeModal, setShowComposeModal] = useState(false)
  const [showReplyModal, setShowReplyModal] = useState(false)
  const [replyingTo, setReplyingTo] = useState(null)
  const [formData, setFormData] = useState({
    recipient_id: '',
    subject: '',
    message: ''
  })
  const [replyData, setReplyData] = useState({
    message: ''
  })
  const [recipients, setRecipients] = useState([])
  const [loading, setLoading] = useState(true)
  const wsRef = useRef(null)
  const lastMessageIdRef = useRef(null)

  useEffect(() => {
    if (user) {
      fetchThreads()
      fetchRecipients()
      connectWebSocket()
    }
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [user])

  useEffect(() => {
    if (selectedThread) {
      fetchThreadMessages(selectedThread.thread_id)
    }
  }, [selectedThread])

  const connectWebSocket = () => {
    const token = localStorage.getItem('token')
    if (!token || !user) return

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    const wsHost = isDevelopment ? 'localhost:8888' : window.location.host
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${wsHost}/api/student/notifications/ws?token=${token}`

    try {
      wsRef.current = new WebSocket(wsUrl)

      wsRef.current.onopen = () => {
        console.log('WebSocket connected for notifications')
        // Send ping periodically to keep connection alive
        const pingInterval = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send('ping')
          } else {
            clearInterval(pingInterval)
          }
        }, 30000) // Every 30 seconds
      }

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'new_message') {
            // Only show notification if it's a new message (not a duplicate)
            if (data.message_id && data.message_id !== lastMessageIdRef.current) {
              lastMessageIdRef.current = data.message_id
              
              // Only show toast if user is not currently viewing this thread
              const isViewingThread = selectedThread && selectedThread.thread_id === data.thread_id
              if (!isViewingThread) {
                toast.info(`New message from ${data.sender_name}: ${data.subject}`, {
                  toastId: `message-${data.message_id}`, // Prevent duplicate toasts
                })
              }
              
              // Refresh threads and current thread if open
              fetchThreads()
              if (isViewingThread) {
                fetchThreadMessages(data.thread_id)
              }
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error)
      }

      wsRef.current.onclose = (event) => {
        console.log('WebSocket disconnected')
        wsRef.current = null
        // Only reconnect if it wasn't a manual close
        if (event.code !== 1000 && user) {
          setTimeout(connectWebSocket, 3000)
        }
      }
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
    }
  }

  const fetchThreads = async () => {
    try {
      const response = await api.get('/student/messages/threads')
      setThreads(response.data)
    } catch (error) {
      toast.error('Failed to fetch message threads')
    } finally {
      setLoading(false)
    }
  }

  const fetchThreadMessages = async (threadId) => {
    if (!user) return
    
    try {
      const response = await api.get('/student/messages', {
        params: { thread_id: threadId }
      })
      setThreadMessages(response.data)
      
      // Mark messages as read
      const userId = user.id || user._id
      if (userId) {
        const unreadMessages = response.data.filter(msg => !msg.read && msg.recipient_id === userId)
        for (const msg of unreadMessages) {
          try {
            await api.put(`/student/messages/${msg.id}/read`)
          } catch (err) {
            console.error('Failed to mark message as read:', err)
          }
        }
      }
      
      // Refresh threads to update unread count
      fetchThreads()
    } catch (error) {
      console.error('Error fetching thread messages:', error)
      toast.error(error.response?.data?.detail || 'Failed to fetch thread messages')
    }
  }

  const fetchRecipients = async () => {
    try {
      // Get faculties from student endpoint
      const facultiesResponse = await api.get('/student/faculties')
      const allRecipients = facultiesResponse.data.map((f) => ({
        id: f.id || f._id,
        name: f.full_name,
        role: 'faculty'
      }))
      setRecipients(allRecipients)
    } catch (error) {
      console.error('Failed to fetch recipients:', error)
      toast.error(error.response?.data?.detail || 'Failed to fetch recipients')
    }
  }

  const handleSend = async (e) => {
    e.preventDefault()
    try {
      await api.post('/student/messages/send', formData)
      toast.success('Message sent successfully')
      setShowComposeModal(false)
      setFormData({ recipient_id: '', subject: '', message: '' })
      fetchThreads()
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send message')
    }
  }

  const handleReply = async (e) => {
    e.preventDefault()
    if (!replyingTo) return

    try {
      await api.post('/student/messages/reply', {
        thread_id: replyingTo.thread_id,
        reply_to: replyingTo.id,
        message: replyData.message,
        subject: replyingTo.subject,
        recipient_id: replyingTo.sender_id
      })
      toast.success('Reply sent successfully')
      setShowReplyModal(false)
      setReplyData({ message: '' })
      setReplyingTo(null)
      fetchThreadMessages(replyingTo.thread_id)
      fetchThreads()
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send reply')
    }
  }

  const handleQuickReply = async (e) => {
    e.preventDefault()
    if (!selectedThread || !replyData.message || replyData.message.trim() === '' || replyData.message === '<p><br></p>') return

    try {
      // Find the last message in the thread to reply to
      const lastMessage = threadMessages[threadMessages.length - 1]
      if (!lastMessage) return

      // Determine recipient
      const recipientId = lastMessage.sender_id === (user?.id || user?._id) 
        ? lastMessage.recipient_id 
        : lastMessage.sender_id

      await api.post('/student/messages/reply', {
        thread_id: selectedThread.thread_id,
        reply_to: lastMessage.id,
        message: replyData.message,
        subject: selectedThread.subject,
        recipient_id: recipientId
      })
      toast.success('Message sent successfully')
      setReplyData({ message: '' })
      fetchThreadMessages(selectedThread.thread_id)
      fetchThreads()
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send message')
    }
  }

  const openReplyModal = (message) => {
    setReplyingTo(message)
    setReplyData({ message: '' })
    setShowReplyModal(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading messages...</p>
        </div>
      </div>
    )
  }

  const quillModules = {
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'color': [] }, { 'background': [] }],
      ['link'],
      ['clean']
    ]
  }

  return (
    <div className="px-4 py-6 h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Messages</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Email-like messaging system</p>
        </div>
        <button
          onClick={() => setShowComposeModal(true)}
          className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-3 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl font-medium flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Compose</span>
        </button>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Threads List */}
        <div className={`w-1/3 border-r ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'} overflow-y-auto`}>
          <div className="p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Threads</h3>
            {threads.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">No messages yet</p>
            ) : (
              <div className="space-y-2">
                {threads.map((thread) => (
                  <div
                    key={thread.thread_id}
                    onClick={() => setSelectedThread(thread)}
                    className={`p-4 rounded-lg cursor-pointer transition-all ${
                      selectedThread?.thread_id === thread.thread_id
                        ? 'bg-blue-100 dark:bg-blue-900/30 border-l-4 border-blue-500'
                        : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold text-gray-900 dark:text-white">{thread.subject}</h4>
                      {thread.unread_count > 0 && (
                        <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
                          {thread.unread_count}
                        </span>
                      )}
                    </div>
                    <p 
                      className="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2"
                      dangerouslySetInnerHTML={{ 
                        __html: thread.last_message 
                          ? thread.last_message.replace(/<[^>]*>/g, '').substring(0, 100) + (thread.last_message.length > 100 ? '...' : '')
                          : '' 
                      }}
                    />
                    <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
                      <span>
                        {thread.participants.map(p => p.name).join(', ')}
                      </span>
                      <span>
                        {new Date(thread.last_message_time).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Thread View - Gmail Style */}
        <div className="flex-1 flex flex-col bg-white dark:bg-gray-900">
          {selectedThread ? (
            <>
              {/* Header - Gmail Style */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    {selectedThread.subject}
                  </h3>
                </div>
                <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400">
                  <span>{selectedThread.participants.map(p => p.name).join(', ')}</span>
                  <span>•</span>
                  <span>{threadMessages.length} {threadMessages.length === 1 ? 'message' : 'messages'}</span>
                </div>
              </div>

              {/* Messages Area - Gmail Style */}
              <div className="flex-1 overflow-y-auto">
                {threadMessages.map((msg, index) => {
                  const isOwnMessage = msg.sender_id === (user?.id || user?._id)
                  
                  // Convert to local date for comparison
                  const msgDate = new Date(msg.created_at)
                  const prevMsgDate = index > 0 ? new Date(threadMessages[index - 1].created_at) : null
                  
                  // Compare local dates (not UTC)
                  const msgLocalDate = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate())
                  const prevLocalDate = prevMsgDate ? new Date(prevMsgDate.getFullYear(), prevMsgDate.getMonth(), prevMsgDate.getDate()) : null
                  const showDateSeparator = index === 0 || !prevLocalDate || msgLocalDate.getTime() !== prevLocalDate.getTime()
                  
                  // Format dates using system timezone
                  const localDate = new Date(msg.created_at)
                  const timeString = localDate.toLocaleTimeString(undefined, { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: true
                  })
                  const dateString = localDate.toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })
                  
                  return (
                    <div key={msg.id}>
                      {showDateSeparator && (
                        <div className="px-6 py-3 text-center text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                          {localDate.toLocaleDateString(undefined, { 
                            weekday: 'long', 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric' 
                          })}
                        </div>
                      )}
                      <div className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        <div className="px-6 py-4">
                          <div className="flex items-start space-x-4">
                            {/* Avatar */}
                            <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold ${
                              isOwnMessage ? 'bg-blue-500' : 'bg-gray-500'
                            }`}>
                              {isOwnMessage ? 'You' : msg.sender_name.charAt(0).toUpperCase()}
                            </div>
                            
                            {/* Message Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center space-x-2">
                                  <span className="font-semibold text-gray-900 dark:text-white">
                                    {isOwnMessage ? 'You' : msg.sender_name}
                                  </span>
                                  {!isOwnMessage && (
                                    <span className="text-sm text-gray-500 dark:text-gray-400">
                                      &lt;{msg.sender_name}&gt;
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
                                  <span>{timeString}</span>
                                  <span>{dateString}</span>
                                </div>
                              </div>
                              
                              {/* Message Body */}
                              <div className="text-gray-700 dark:text-gray-300 ql-editor mt-2">
                                <div dangerouslySetInnerHTML={{ __html: msg.message || '' }} />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Reply Area - Gmail Style */}
              <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="p-4">
                  <div className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                    <span className="font-medium">Reply to:</span> {selectedThread.participants.map(p => p.name).join(', ')}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (replyingTo) {
                        handleReply(e)
                      } else {
                        handleQuickReply(e)
                      }
                    }}
                  >
                    <div className={theme === 'dark' ? 'quill-dark' : ''}>
                      <ReactQuill
                        theme="snow"
                        value={replyData.message}
                        onChange={(value) => setReplyData({ message: value })}
                        modules={quillModules}
                        placeholder="Click here to reply..."
                        className={`${theme === 'dark' ? 'bg-gray-700' : 'bg-white'} border border-gray-300 dark:border-gray-600 rounded-lg`}
                        style={{ minHeight: '150px' }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Press Enter to send, Shift+Enter for new line
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setReplyData({ message: '' })}
                          className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                          Discard
                        </button>
                        <button
                          type="submit"
                          disabled={!replyData.message || replyData.message.trim() === '' || replyData.message === '<p><br></p>'}
                          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 dark:text-gray-400">Select a thread to view messages</p>
            </div>
          )}
        </div>
      </div>

      {/* Compose Modal */}
      {showComposeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto ${theme === 'dark' ? 'dark' : ''}`}>
            <div className="p-6">
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Compose Message</h3>
              <form onSubmit={handleSend}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    To
                  </label>
                  <select
                    value={formData.recipient_id}
                    onChange={(e) => setFormData({ ...formData, recipient_id: e.target.value })}
                    className={`w-full px-4 py-2 border rounded-lg ${
                      theme === 'dark'
                        ? 'bg-gray-700 text-white border-gray-600'
                        : 'bg-white text-gray-900 border-gray-300'
                    }`}
                    required
                  >
                    <option value="">Select recipient</option>
                    {recipients.map((recipient) => (
                      <option key={recipient.id} value={recipient.id}>
                        {recipient.name} ({recipient.role})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    className={`w-full px-4 py-2 border rounded-lg ${
                      theme === 'dark'
                        ? 'bg-gray-700 text-white border-gray-600'
                        : 'bg-white text-gray-900 border-gray-300'
                    }`}
                    required
                  />
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Message
                  </label>
                  <div className={theme === 'dark' ? 'quill-dark' : ''}>
                    <ReactQuill
                      theme="snow"
                      value={formData.message}
                      onChange={(value) => setFormData({ ...formData, message: value })}
                      modules={quillModules}
                      className={`${theme === 'dark' ? 'bg-gray-700' : 'bg-white'}`}
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowComposeModal(false)
                      setFormData({ recipient_id: '', subject: '', message: '' })
                    }}
                    className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    Send
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Reply Modal */}
      {showReplyModal && replyingTo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto ${theme === 'dark' ? 'dark' : ''}`}>
            <div className="p-6">
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Reply</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                To: {replyingTo.sender_name} | Subject: {replyingTo.subject}
              </p>
              <form onSubmit={handleReply}>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Your Reply
                  </label>
                  <div className={theme === 'dark' ? 'quill-dark' : ''}>
                    <ReactQuill
                      theme="snow"
                      value={replyData.message}
                      onChange={(value) => setReplyData({ message: value })}
                      modules={quillModules}
                      className={`${theme === 'dark' ? 'bg-gray-700' : 'bg-white'}`}
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowReplyModal(false)
                      setReplyingTo(null)
                      setReplyData({ message: '' })
                    }}
                    className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    Send Reply
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .quill-dark .ql-toolbar {
          background: #374151;
          border-color: #4b5563;
        }
        .quill-dark .ql-container {
          background: #374151;
          border-color: #4b5563;
          color: white;
        }
        .quill-dark .ql-editor {
          color: white;
        }
        .quill-dark .ql-stroke {
          stroke: white;
        }
        .quill-dark .ql-fill {
          fill: white;
        }
        .quill-dark .ql-picker-label {
          color: white;
        }
        .ql-editor {
          padding: 0;
        }
        .ql-editor p {
          margin: 0.5em 0;
        }
        .ql-editor ul, .ql-editor ol {
          padding-left: 1.5em;
          margin: 0.5em 0;
        }
        .ql-editor h1, .ql-editor h2, .ql-editor h3 {
          margin: 0.5em 0;
          font-weight: bold;
        }
        .ql-editor h1 {
          font-size: 2em;
        }
        .ql-editor h2 {
          font-size: 1.5em;
        }
        .ql-editor h3 {
          font-size: 1.17em;
        }
        .ql-editor a {
          color: #3b82f6;
          text-decoration: underline;
        }
        .ql-editor strong {
          font-weight: bold;
        }
        .ql-editor em {
          font-style: italic;
        }
        .ql-editor u {
          text-decoration: underline;
        }
        .ql-editor s {
          text-decoration: line-through;
        }
        .ql-editor.ql-snow {
          border: none;
        }
        .ql-toolbar.ql-snow {
          border: none;
          border-bottom: 1px solid #e5e7eb;
        }
        .ql-container.ql-snow {
          border: none;
        }
        .ql-editor {
          font-size: 14px;
          line-height: 1.5;
        }
        .ql-editor.ql-blank::before {
          color: #9ca3af;
          font-style: normal;
        }
      `}</style>
    </div>
  )
}

export default Messages

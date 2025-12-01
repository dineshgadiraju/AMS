import { useTheme } from '../contexts/ThemeContext'

function Footer() {
  const { theme } = useTheme()
  const currentYear = new Date().getFullYear()

  return (
    <footer className={`border-t ${
      theme === 'dark' 
        ? 'bg-gray-800 border-gray-700 text-gray-300' 
        : 'bg-white border-gray-200 text-gray-600'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col sm:flex-row justify-between items-center">
          <div className="text-sm text-center sm:text-left">
            © {currentYear} Attendance Management System. All rights reserved.
          </div>
          <div className="text-sm mt-2 sm:mt-0 text-center sm:text-right">
            <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}>
              Powered by Face Recognition Technology
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer


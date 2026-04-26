import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, setCache } from '../hooks/useApi'
import { authApi } from '../api'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const login = useMutation(
    () => authApi.login({ username, password, remember }),
    {
      onSuccess: () => {
        setCache('auth-status', { authenticated: true, username })
        navigate('/app', { replace: true })
      },
      onError: (err: unknown) => {
        const e = err as { message?: string }
        setError(e?.message ?? '登录失败，请检查用户名和密码')
      },
    }
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    login.mutate(undefined)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-500 rounded-xl mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-slate-800">Work Schedule</h1>
          <p className="text-sm text-slate-500 mt-1">登录以继续</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-colors"
              placeholder="请输入用户名"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-colors"
              placeholder="请输入密码"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-400"
            />
            <span className="text-sm text-slate-600">记住我</span>
          </label>

          <button
            type="submit"
            disabled={login.pending}
            className="w-full py-2 px-4 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {login.pending ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}

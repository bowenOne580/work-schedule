import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useMutation, setCache } from '../hooks/useApi'
import { authApi } from '../api'
import {
  LayoutDashboard, CheckSquare, BarChart2, AlertTriangle, Settings, LogOut, Menu, X, Archive,
} from 'lucide-react'

const navItems = [
  { to: '/app', label: '今日', icon: LayoutDashboard, end: true },
  { to: '/app/tasks', label: '任务', icon: CheckSquare, end: false },
  { to: '/app/stats', label: '统计', icon: BarChart2, end: false },
  { to: '/app/anomalies', label: '异常', icon: AlertTriangle, end: false },
  { to: '/app/archive', label: '归档', icon: Archive, end: false },
  { to: '/app/settings', label: '设置', icon: Settings, end: false },
]

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()

  const logout = useMutation(authApi.logout, {
    onSuccess: () => {
      setCache('auth-status', { authenticated: false })
      navigate('/login')
    },
  })

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar - desktop */}
      <aside
        className={`hidden md:flex flex-col border-r border-slate-200 bg-white transition-all duration-200 ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200">
          {!collapsed && (
            <span className="font-semibold text-slate-800 text-sm tracking-wide">Work Schedule</span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors ml-auto"
          >
            {collapsed ? <Menu size={16} /> : <X size={16} />}
          </button>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-600 font-medium'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                }`
              }
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="px-2 pb-4">
          <button
            onClick={() => logout.mutate(undefined)}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && <span>退出登录</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <Outlet />
        </div>

        {/* Bottom nav - mobile */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex z-10">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
                  isActive ? 'text-indigo-600' : 'text-slate-500'
                }`
              }
            >
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </main>
    </div>
  )
}

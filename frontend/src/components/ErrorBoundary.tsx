import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-4">
          <p className="text-slate-500 text-sm">页面出现错误，请刷新重试</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 text-sm text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg"
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

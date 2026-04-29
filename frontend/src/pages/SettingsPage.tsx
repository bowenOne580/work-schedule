import { useState } from 'react'
import { useQuery, useMutation, invalidate } from '../hooks/useApi'
import { categoriesApi, systemApi } from '../api'
import { Plus, Trash2, Lock, Download, Upload, RefreshCw, ExternalLink } from 'lucide-react'
import type { ExportPayload } from '../types'

const SYSTEM_CATS = ['cat-general', 'cat-anomaly', 'cat-archived']
const SYSTEM_LABELS: Record<string, string> = {
  'cat-general': '默认分类',
  'cat-anomaly': '异常任务桶',
  'cat-archived': '归档桶',
}

export default function SettingsPage() {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [adding, setAdding] = useState(false)
  const [mutationError, setMutationError] = useState('')

  const [exporting, setExporting] = useState(false)
  const [importPreview, setImportPreview] = useState<ExportPayload | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  const [versionInfo, setVersionInfo] = useState<{ version: string; latestVersion: string } | null>(null)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'confirming' | 'updating' | 'done'>('idle')
  const [updateError, setUpdateError] = useState('')

  const { data: categories = [], error: loadError } = useQuery('categories', categoriesApi.list)

  const create = useMutation(
    () => categoriesApi.create({ name, description: desc }),
    {
      onSuccess: () => { invalidate('categories'); setName(''); setDesc(''); setAdding(false); setMutationError('') },
      onError: () => setMutationError('创建失败，请重试'),
    }
  )

  const remove = useMutation(
    (id: string) => categoriesApi.delete(id),
    {
      onSuccess: () => { invalidate('categories'); setMutationError('') },
      onError: () => setMutationError('删除失败，请重试'),
    }
  )

  const userCats = categories.filter(c => !SYSTEM_CATS.includes(c.id))
  const sysCats = categories.filter(c => SYSTEM_CATS.includes(c.id))

  const handleExport = async () => {
    setExporting(true)
    try {
      const data = await systemApi.exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `work-schedule-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setMutationError('导出失败，请重试')
    } finally {
      setExporting(false)
    }
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string)
        if (!parsed?.version || !parsed?.data) {
          setImportError('无效的备份文件格式')
          return
        }
        setImportPreview(parsed as ExportPayload)
      } catch {
        setImportError('文件解析失败，请选择有效的 JSON 文件')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const confirmImport = async () => {
    if (!importPreview) return
    setImporting(true)
    setImportError('')
    try {
      await systemApi.importData(importPreview)
      invalidate('categories')
      invalidate('tasks')
      invalidate('checkpoints')
      setImportPreview(null)
      setMutationError('')
      alert('导入成功！数据已恢复。')
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message || '导入失败，请重试'
      setImportError(msg)
    } finally {
      setImporting(false)
    }
  }

  const handleCheckVersion = async () => {
    try {
      const info = await systemApi.version()
      setVersionInfo(info)
    } catch {
      setUpdateError('获取版本信息失败')
    }
  }

  const handleUpdate = async () => {
    setUpdateStatus('updating')
    setUpdateError('')
    try {
      await systemApi.update()
      setUpdateStatus('done')
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message || '更新失败'
      setUpdateError(msg)
      setUpdateStatus('idle')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">分类管理</h1>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors"
        >
          <Plus size={13} /> 新建分类
        </button>
      </div>

      {(loadError || mutationError) && (
        <p className="text-sm text-red-500">{mutationError || '加载失败，请刷新重试'}</p>
      )}

      {adding && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-slate-700">新建分类</h3>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="分类名称"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
          />
          <input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="描述（可选）"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); setName(''); setDesc('') }} className="px-3 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">取消</button>
            <button
              onClick={() => name.trim() && create.mutate(undefined)}
              disabled={!name.trim() || create.pending}
              className="px-3 py-1.5 text-xs text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {userCats.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">暂无自定义分类</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {userCats.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{c.name}</p>
                  {c.description && <p className="text-xs text-slate-400 mt-0.5">{c.description}</p>}
                </div>
                <button
                  onClick={() => { if (confirm(`确认删除分类「${c.name}」？`)) remove.mutate(c.id) }}
                  className="text-slate-300 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">系统分类（只读）</h2>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="divide-y divide-slate-100">
            {sysCats.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                <Lock size={13} className="text-slate-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-600">{SYSTEM_LABELS[c.id] ?? c.name}</p>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">{c.id}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <hr className="border-slate-200" />

      {/* Export */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-1">数据导出</h2>
        <p className="text-xs text-slate-400 mb-3">将所有任务、检查点和分类数据导出为 JSON 文件</p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors disabled:opacity-50"
        >
          <Download size={13} /> {exporting ? '导出中...' : '导出数据'}
        </button>
      </div>

      {/* Import */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-1">数据导入</h2>
        <p className="text-xs text-slate-400 mb-3">上传之前导出的 JSON 文件，将完全替换当前数据</p>
        <input
          type="file"
          accept=".json"
          onChange={handleImportFile}
          className="hidden"
          id="import-file-input"
        />
        <label
          htmlFor="import-file-input"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer transition-colors"
        >
          <Upload size={13} /> 选择文件导入
        </label>
        {importError && <p className="text-xs text-red-500 mt-2">{importError}</p>}
      </div>

      {/* Import confirmation dialog */}
      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl space-y-4">
            <h3 className="text-sm font-semibold text-slate-800">确认导入</h3>
            <p className="text-xs text-slate-500">此操作将完全替换当前数据，请确认备份文件包含以下内容：</p>
            <ul className="text-xs text-slate-600 space-y-1">
              <li>任务：{importPreview.data.tasks.length} 个</li>
              <li>检查点：{importPreview.data.checkpoints.length} 个</li>
              <li>分类：{importPreview.data.categories.length} 个</li>
              <li>导出版本：{importPreview.version}</li>
              <li>导出时间：{new Date(importPreview.exportedAt).toLocaleString('zh-CN')}</li>
            </ul>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setImportPreview(null)}
                className="px-3 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={confirmImport}
                disabled={importing}
                className="px-3 py-1.5 text-xs text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg disabled:opacity-50"
              >
                {importing ? '导入中...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}

      <hr className="border-slate-200" />

      {/* Update */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-1">版本更新</h2>
        <p className="text-xs text-slate-400 mb-3">从 GitHub 拉取最新代码并重启服务器</p>

        <div className="flex items-center gap-2 mb-3">
          {versionInfo && (
            <span className="text-xs text-slate-500">
              当前版本：v{versionInfo.version}{versionInfo.latestVersion ? `（最新版本：${versionInfo.latestVersion}）` : ''}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleCheckVersion}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <RefreshCw size={13} /> 检查版本
          </button>

          <a
            href="https://github.com/bowenOne580/work-schedule/tags"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <ExternalLink size={13} /> 查看更新
          </a>

          {updateStatus === 'idle' && (
            <button
              onClick={() => setUpdateStatus('confirming')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors"
            >
              <RefreshCw size={13} /> 一键更新
            </button>
          )}
        </div>

        {updateError && <p className="text-xs text-red-500 mt-2">{updateError}</p>}
      </div>

      {/* Update confirmation dialog */}
      {updateStatus === 'confirming' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl space-y-4">
            <h3 className="text-sm font-semibold text-slate-800">确认更新</h3>
            <p className="text-xs text-slate-500">将执行以下操作：</p>
            <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
              <li>从 GitHub 下载最新代码</li>
              <li>替换现有文件（保留数据）</li>
              <li>安装依赖并构建前端</li>
              <li>重启服务器（需进程管理器自动拉起）</li>
            </ul>
            <p className="text-xs text-amber-600 font-medium">更新期间服务将暂时不可用</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setUpdateStatus('idle')}
                className="px-3 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleUpdate}
                className="px-3 py-1.5 text-xs text-white bg-orange-500 hover:bg-orange-600 rounded-lg"
              >
                确认更新
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Update progress */}
      {updateStatus === 'updating' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl space-y-4 text-center">
            <RefreshCw size={24} className="mx-auto text-indigo-500 animate-spin" />
            <p className="text-sm font-medium text-slate-700">正在下载更新...</p>
            <p className="text-xs text-slate-400">请勿关闭页面</p>
          </div>
        </div>
      )}

      {/* Update done */}
      {updateStatus === 'done' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl space-y-4 text-center">
            <p className="text-sm font-medium text-green-600">更新完成！</p>
            <p className="text-xs text-slate-500">服务器正在重启，请在几秒后刷新页面</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg"
            >
              刷新页面
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

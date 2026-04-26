import { useState } from 'react'
import { useQuery, useMutation, invalidate } from '../hooks/useApi'
import { categoriesApi } from '../api'
import { Plus, Trash2, Lock } from 'lucide-react'

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

  const { data: categories = [] } = useQuery('categories', categoriesApi.list)

  const create = useMutation(
    () => categoriesApi.create({ name, description: desc }),
    { onSuccess: () => { invalidate('categories'); setName(''); setDesc(''); setAdding(false) } }
  )

  const remove = useMutation(
    (id: string) => categoriesApi.delete(id),
    { onSuccess: () => invalidate('categories') }
  )

  const userCats = categories.filter(c => !SYSTEM_CATS.includes(c.id))
  const sysCats = categories.filter(c => SYSTEM_CATS.includes(c.id))

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
    </div>
  )
}

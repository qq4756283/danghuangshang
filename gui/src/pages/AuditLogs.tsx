import { useEffect, useState } from "react"
import { useTheme } from "../theme"
import { getAuthToken } from "../utils/auth"

interface AuditItem {
  id: string
  actor: string
  action: string
  targetType: string
  targetId: string
  createdAt: number
  before?: Record<string, any>
  after?: Record<string, any>
}

interface Props {
  initialFilter?: {
    targetType?: string
    targetId?: string
    action?: string
  }
}

export default function AuditLogs({ initialFilter }: Props) {
  const { theme } = useTheme()
  const [items, setItems] = useState<AuditItem[]>([])
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState(initialFilter?.action || '')
  const [targetType, setTargetType] = useState(initialFilter?.targetType || 'all')
  const [targetId, setTargetId] = useState(initialFilter?.targetId || '')

  const bg = theme === 'light' ? 'bg-white border border-gray-200' : 'bg-[#1a1a2e]'
  const sub = theme === 'light' ? 'text-gray-500' : 'text-[#a3a3a3]'

  useEffect(() => {
    setAction(initialFilter?.action || '')
    setTargetType(initialFilter?.targetType || 'all')
    setTargetId(initialFilter?.targetId || '')
  }, [initialFilter])

  const load = async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (action.trim()) qs.set('action', action.trim())
      if (targetType !== 'all') qs.set('targetType', targetType)
      if (targetId.trim()) qs.set('targetId', targetId.trim())
      qs.set('limit', '100')
      const r = await fetch(`/api/audit?${qs.toString()}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } })
      if (r.status === 401) {
        localStorage.removeItem('boluo_auth_token')
        window.location.reload()
        return
      }
      const d = await r.json()
      setItems(Array.isArray(d.items) ? d.items : [])
    } catch {
      setItems([])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [action, targetType, targetId])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input value={action} onChange={e => setAction(e.target.value)} placeholder="筛选 action..." className={`flex-1 min-w-[160px] px-3 py-2 text-sm rounded border ${theme === 'light' ? 'bg-white border-gray-300' : 'bg-[#0d0d1a] border-[#d4a574]/20'} focus:outline-none focus:border-[#d4a574]`} />
        <select value={targetType} onChange={e => setTargetType(e.target.value)} className={`px-3 py-2 text-sm rounded border ${theme === 'light' ? 'bg-white border-gray-300' : 'bg-[#0d0d1a] border-[#d4a574]/20'}`}>
          <option value="all">全部对象</option>
          <option value="session">session</option>
          <option value="agent">agent</option>
        </select>
        <input value={targetId} onChange={e => setTargetId(e.target.value)} placeholder="筛选 targetId..." className={`flex-1 min-w-[220px] px-3 py-2 text-sm rounded border ${theme === 'light' ? 'bg-white border-gray-300' : 'bg-[#0d0d1a] border-[#d4a574]/20'} focus:outline-none focus:border-[#d4a574]`} />
        <button onClick={load} className="px-3 py-2 text-sm border border-[#d4a574]/30 text-[#d4a574] rounded hover:bg-[#d4a574]/10 cursor-pointer">↻ 刷新</button>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className={`${bg} rounded-lg p-6 text-center ${sub}`}>加载审计日志中...</div>
        ) : items.length === 0 ? (
          <div className={`${bg} rounded-lg p-6 text-center ${sub}`}>暂无审计记录</div>
        ) : items.map(item => (
          <div key={item.id} className={`${bg} rounded-lg p-3`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-medium text-[#d4a574]">{item.action}</div>
                <div className={`text-xs ${sub}`}>{item.targetType}:{item.targetId}</div>
              </div>
              <div className={`text-xs ${sub} text-right`}>
                <div>{item.actor}</div>
                <div>{new Date(item.createdAt).toLocaleString('zh-CN')}</div>
              </div>
            </div>
            {(item.before || item.after) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3 text-xs">
                <div className={`rounded p-2 ${theme === 'light' ? 'bg-gray-50' : 'bg-[#0d0d1a]'}`}>
                  <div className={`mb-1 ${sub}`}>Before</div>
                  <pre className="whitespace-pre-wrap break-all">{JSON.stringify(item.before || {}, null, 2)}</pre>
                </div>
                <div className={`rounded p-2 ${theme === 'light' ? 'bg-gray-50' : 'bg-[#0d0d1a]'}`}>
                  <div className={`mb-1 ${sub}`}>After</div>
                  <pre className="whitespace-pre-wrap break-all">{JSON.stringify(item.after || {}, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

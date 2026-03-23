import { useEffect, useMemo, useState } from "react"
import { useTheme } from "../theme"
import { getAuthToken } from "../utils/auth"

interface AgentItem {
  id: string
  displayName: string
  model: string
  status: 'online' | 'paused' | 'warning' | 'error' | 'offline'
  sessionCount: number
  activeSessionCount: number
  totalTokens: number
  lastActiveAt: number | null
  lastError?: string | null
}

interface AgentSummarySession {
  id: string
  updatedAt: number
  messageCount: number
  totalTokens: number
  status: string
  lastError?: string | null
}

interface AgentSummary {
  recentSessions: AgentSummarySession[]
  recentErrors: string[]
  health?: { score: number; label: string }
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function relTime(ts: number | null | undefined) {
  if (!ts) return '未知'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}天前`
  if (h > 0) return `${h}小时前`
  if (m > 0) return `${m}分钟前`
  return '刚刚'
}

function statusTone(status: AgentItem['status']) {
  switch (status) {
    case 'online': return 'text-green-400 bg-green-500/15 border-green-500/30'
    case 'warning': return 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30'
    case 'error': return 'text-red-400 bg-red-500/15 border-red-500/30'
    case 'paused': return 'text-gray-300 bg-gray-500/15 border-gray-500/30'
    default: return 'text-gray-400 bg-gray-500/15 border-gray-500/30'
  }
}

export default function Agents() {
  const { theme } = useTheme()
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | AgentItem['status']>('all')
  const [sortBy, setSortBy] = useState<'tokens' | 'lastActiveAt' | 'sessionCount'>('lastActiveAt')
  const [selected, setSelected] = useState<AgentItem | null>(null)
  const [summary, setSummary] = useState<AgentSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  const bg = theme === 'light' ? 'bg-white border border-gray-200' : 'bg-[#1a1a2e]'
  const sub = theme === 'light' ? 'text-gray-500' : 'text-[#a3a3a3]'

  const loadAgents = async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (query.trim()) qs.set('q', query.trim())
      if (status !== 'all') qs.set('status', status)
      qs.set('sortBy', sortBy)
      qs.set('order', 'desc')
      const r = await fetch(`/api/agents?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      })
      if (r.status === 401) {
        localStorage.removeItem('boluo_auth_token')
        window.location.reload()
        return
      }
      const d = await r.json()
      setAgents(Array.isArray(d.agents) ? d.agents : [])
    } catch {
      setAgents([])
    }
    setLoading(false)
  }

  const loadSummary = async (agent: AgentItem) => {
    setSelected(agent)
    setSummaryLoading(true)
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/summary`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      })
      if (r.status === 401) {
        localStorage.removeItem('boluo_auth_token')
        window.location.reload()
        return
      }
      const d = await r.json()
      setSummary(d.summary || null)
    } catch {
      setSummary(null)
    }
    setSummaryLoading(false)
  }

  useEffect(() => { loadAgents() }, [status, sortBy])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return agents.filter(a => {
      if (status !== 'all' && a.status !== status) return false
      if (!q) return true
      return a.displayName.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || (a.model || '').toLowerCase().includes(q)
    })
  }, [agents, query, status])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: '总 Agent', v: agents.length, c: 'text-[#d4a574]' },
          { l: '在线', v: agents.filter(a => a.status === 'online').length, c: 'text-green-400' },
          { l: '告警/错误', v: agents.filter(a => a.status === 'warning' || a.status === 'error').length, c: 'text-yellow-400' },
          { l: '总 Token', v: fmt(agents.reduce((s, a) => s + a.totalTokens, 0)), c: 'text-[#d4a574]' },
        ].map(card => (
          <div key={card.l} className={`${bg} rounded-lg p-3`}>
            <div className={`text-[10px] uppercase ${sub}`}>{card.l}</div>
            <div className={`font-mono text-lg sm:text-2xl ${card.c}`}>{card.v}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索 Agent / 模型..."
          className={`flex-1 min-w-[180px] px-3 py-2 text-sm rounded border ${theme === 'light' ? 'bg-white border-gray-300' : 'bg-[#0d0d1a] border-[#d4a574]/20'} focus:outline-none focus:border-[#d4a574]`}
        />
        <select value={status} onChange={e => setStatus(e.target.value as any)} className={`px-3 py-2 text-sm rounded border ${theme === 'light' ? 'bg-white border-gray-300' : 'bg-[#0d0d1a] border-[#d4a574]/20'}`}>
          <option value="all">全部状态</option>
          <option value="online">在线</option>
          <option value="warning">告警</option>
          <option value="error">错误</option>
          <option value="paused">暂停</option>
          <option value="offline">离线</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className={`px-3 py-2 text-sm rounded border ${theme === 'light' ? 'bg-white border-gray-300' : 'bg-[#0d0d1a] border-[#d4a574]/20'}`}>
          <option value="lastActiveAt">按最近活跃</option>
          <option value="tokens">按 Token</option>
          <option value="sessionCount">按会话数</option>
        </select>
        <button onClick={loadAgents} className="px-3 py-2 text-sm border border-[#d4a574]/30 text-[#d4a574] rounded hover:bg-[#d4a574]/10 cursor-pointer">↻ 刷新</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_0.9fr] gap-4">
        <div className="space-y-2">
          {loading ? (
            <div className={`${bg} rounded-lg p-6 text-center ${sub}`}>加载中...</div>
          ) : filtered.length === 0 ? (
            <div className={`${bg} rounded-lg p-6 text-center ${sub}`}>暂无 Agent 数据</div>
          ) : filtered.map(agent => (
            <div key={agent.id} className={`${bg} rounded-lg p-3 cursor-pointer hover:ring-1 hover:ring-[#d4a574]/30 transition-all`} onClick={() => loadSummary(agent)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{agent.displayName}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${statusTone(agent.status)}`}>{agent.status}</span>
                  </div>
                  <div className={`text-[10px] sm:text-xs mt-1 ${sub}`}>{agent.id} · {agent.model || '-'}</div>
                  {agent.lastError && (
                    <div className="text-[10px] sm:text-xs mt-1 text-red-400 break-all">⚠ {agent.lastError}</div>
                  )}
                </div>
                <div className="text-right text-[10px] sm:text-xs flex-shrink-0">
                  <div className="text-[#d4a574] font-mono">🔥 {fmt(agent.totalTokens)}</div>
                  <div className={sub}>会话 {agent.sessionCount}</div>
                  <div className={sub}>活跃 {agent.activeSessionCount}</div>
                  <div className={sub}>{relTime(agent.lastActiveAt)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className={`${bg} rounded-lg p-4 min-h-[240px]`}>
          {!selected ? (
            <div className={`h-full flex items-center justify-center text-sm ${sub}`}>点击左侧 Agent 查看详情</div>
          ) : summaryLoading ? (
            <div className={`h-full flex items-center justify-center text-sm ${sub}`}>加载详情中...</div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-semibold text-[#d4a574]">{selected.displayName}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded border ${statusTone(selected.status)}`}>{selected.status}</span>
                </div>
                <div className={`text-xs mt-1 ${sub}`}>{selected.id} · {selected.model}</div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className={sub}>总会话</div>
                  <div className="font-mono text-[#d4a574]">{selected.sessionCount}</div>
                </div>
                <div>
                  <div className={sub}>活跃会话</div>
                  <div className="font-mono text-green-400">{selected.activeSessionCount}</div>
                </div>
                <div>
                  <div className={sub}>总 Token</div>
                  <div className="font-mono text-[#d4a574]">{fmt(selected.totalTokens)}</div>
                </div>
                <div>
                  <div className={sub}>最近活跃</div>
                  <div className="font-mono">{relTime(selected.lastActiveAt)}</div>
                </div>
              </div>

              {selected.lastError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 break-all">
                  最近错误：{selected.lastError}
                </div>
              )}

              <div>
                <div className={`text-xs uppercase mb-2 ${sub}`}>最近会话</div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto">
                  {(summary?.recentSessions || []).length === 0 ? (
                    <div className={`text-sm ${sub}`}>暂无最近会话</div>
                  ) : (summary?.recentSessions || []).map(sess => (
                    <div key={sess.id} className={`rounded-lg p-2 ${theme === 'light' ? 'bg-gray-50' : 'bg-[#0d0d1a]'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs truncate">{sess.id}</div>
                          <div className={`text-[10px] ${sub}`}>💬 {sess.messageCount} · 🔥 {fmt(sess.totalTokens)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-[#d4a574]">{sess.status}</div>
                          <div className={`text-[10px] ${sub}`}>{relTime(sess.updatedAt)}</div>
                        </div>
                      </div>
                      {sess.lastError && <div className="mt-1 text-[10px] text-red-400 break-all">⚠ {sess.lastError}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

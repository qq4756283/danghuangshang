import { useState, useEffect } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { useTheme } from "../theme"
import { getAuthToken } from "../utils/auth"

interface Session {
  id: string; agentId: string; agentName: string; channel: string
  updatedAt: number; createdAt?: number; messageCount: number
  inputTokens: number; outputTokens: number
  status?: 'active' | 'idle' | 'needs-human' | 'error' | 'archived'
  lastError?: string | null
  lastIntervenedAt?: number | null
  lastIntervenedBy?: string | null
}

interface SessionSummary {
  totalTokens: number; messageCount: number
  firstMessage?: { timestamp: string; preview: string }
  lastMessage?: { timestamp: string; preview: string }
  avgResponseTimeMs?: number; avgResponseTimeSec?: string
}

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

interface SessionDetail extends Session {
  messages?: Message[]
  summary?: SessionSummary | null
  summaryLoading?: boolean
}

interface Message { id: string; role: string; content: string; timestamp: string; type?: string; toolName?: string; toolStatus?: string }

interface Props {
  initialFilter?: string
  onOpenAudit?: (targetId: string) => void
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toString()
}

function relTime(ts: number) {
  if (!ts) return '未知'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24)
  if (d > 0) return `${d}天前`
  if (h > 0) return `${h}小时前`
  if (m > 0) return `${m}分钟前`
  return '刚刚'
}

function sessionStatus(s: Session): { label: string; color: string; bg: string } {
  if (s.status === 'needs-human') return { label: '待人工', color: 'text-yellow-300', bg: 'bg-yellow-500/20' }
  if (s.status === 'error') return { label: '异常', color: 'text-red-400', bg: 'bg-red-500/20' }
  if (s.status === 'archived') return { label: '归档', color: 'text-gray-400', bg: 'bg-gray-500/20' }
  if (s.status === 'idle') return { label: '空闲', color: 'text-yellow-400', bg: 'bg-yellow-500/20' }
  if (s.status === 'active') return { label: '活跃', color: 'text-green-400', bg: 'bg-green-500/20' }

  const diff = Date.now() - s.updatedAt
  if (diff < 3600000) return { label: '活跃', color: 'text-green-400', bg: 'bg-green-500/20' }
  if (diff < 86400000) return { label: '空闲', color: 'text-yellow-400', bg: 'bg-yellow-500/20' }
  return { label: '归档', color: 'text-gray-400', bg: 'bg-gray-500/20' }
}

function MessageTimeline({ messages }: { messages: Message[] }) {
  const { theme } = useTheme()
  const sub = theme === 'light' ? 'text-gray-500' : 'text-[#a3a3a3]'

  if (!messages || messages.length === 0) return null

  const hourMap: Record<string, { user: number; assistant: number }> = {}
  messages.forEach(msg => {
    const d = new Date(msg.timestamp)
    const hour = `${d.getHours().toString().padStart(2, '0')}:00`
    if (!hourMap[hour]) hourMap[hour] = { user: 0, assistant: 0 }
    if (msg.role === 'user') hourMap[hour].user++
    else hourMap[hour].assistant++
  })

  const chartData = Object.entries(hourMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, counts]) => ({ hour, ...counts }))

  if (chartData.length === 0) return null

  return (
    <div className="mt-3">
      <h4 className={`text-[10px] sm:text-xs font-medium ${sub} mb-2`}>📊 消息时间分布</h4>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme === 'light' ? '#e5e7eb' : '#333'} />
          <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#a3a3a3' }} />
          <YAxis tick={{ fontSize: 9, fill: '#a3a3a3' }} width={25} />
          <Tooltip
            contentStyle={{
              backgroundColor: theme === 'light' ? '#fff' : '#1a1a2e',
              border: '1px solid #d4a574',
              borderRadius: 8,
              fontSize: 11,
            }}
          />
          <Bar dataKey="user" fill="#6366f1" name="用户" radius={[2, 2, 0, 0]} />
          <Bar dataKey="assistant" fill="#d4a574" name="助手" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function exportSession(session: SessionDetail) {
  const exportData = {
    id: session.id,
    agent: session.agentName,
    channel: session.channel,
    messageCount: session.messageCount,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    updatedAt: new Date(session.updatedAt).toISOString(),
    summary: session.summary || null,
    messages: session.messages?.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })) || [],
    exportedAt: new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `session-${session.agentName}-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export default function Sessions({ initialFilter, onOpenAudit }: Props) {
  const { theme } = useTheme()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [filterDept, setFilterDept] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'idle' | 'needs-human' | 'error' | 'archived'>('all')
  const [errorOnly, setErrorOnly] = useState(false)
  const [intervenedOnly, setIntervenedOnly] = useState(false)
  const [sortBy, setSortBy] = useState<'time' | 'tokens' | 'messages'>('time')
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null)
  const [msgsLoading, setMsgsLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedSummary, setExpandedSummary] = useState<Record<string, SessionSummary | null>>({})
  const [expandedLoading, setExpandedLoading] = useState<Record<string, boolean>>({})
  const [interventionMessage, setInterventionMessage] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [sessionAudit, setSessionAudit] = useState<AuditItem[]>([])
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const bg = theme === 'light' ? 'bg-white border border-gray-200' : 'bg-[#1a1a2e]'
  const sub = theme === 'light' ? 'text-gray-500' : 'text-[#a3a3a3]'

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    if (initialFilter) {
      setFilterDept(initialFilter)
    }
  }, [initialFilter])

  const fetchSessions = async () => {
    try {
      const qs = new URLSearchParams()
      qs.set('limit', '150')
      if (statusFilter !== 'all') qs.set('status', statusFilter)
      if (errorOnly) qs.set('hasError', 'true')
      if (intervenedOnly) qs.set('intervened', 'true')
      if (filter.trim()) qs.set('q', filter.trim())
      const r = await fetch(`/api/sessions?${qs.toString()}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } })
      if (r.status === 401) {
        localStorage.removeItem('boluo_auth_token')
        window.location.reload()
        return
      }
      if (r.ok) {
        const d = await r.json()
        setSessions(Array.isArray(d.sessions) ? d.sessions : [])
        const ids = new Set((d.sessions || []).map((s: Session) => s.id))
        setExpandedSummary(prev => {
          const cleaned: Record<string, SessionSummary | null> = {}
          for (const key of Object.keys(prev)) if (ids.has(key)) cleaned[key] = prev[key]
          return cleaned
        })
        setExpandedLoading(prev => {
          const cleaned: Record<string, boolean> = {}
          for (const key of Object.keys(prev)) if (ids.has(key)) cleaned[key] = prev[key]
          return cleaned
        })
      }
    } catch { }
    setLoading(false)
  }

  const fetchMessages = async (sessionId: string) => {
    setMsgsLoading(true)
    try {
      const [msgRes, detailRes, auditRes] = await Promise.all([
        fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=50`, { headers: { Authorization: `Bearer ${getAuthToken()}` } }),
        fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } }),
        fetch(`/api/audit?targetType=session&targetId=${encodeURIComponent(sessionId)}&limit=20`, { headers: { Authorization: `Bearer ${getAuthToken()}` } }),
      ])

      const msgs = msgRes.ok ? ((await msgRes.json()).messages || []) : []
      const detail = detailRes.ok ? ((await detailRes.json()).session || null) : null
      const audit = auditRes.ok ? ((await auditRes.json()).items || []) : []
      setSessionAudit(audit)
      setSelectedSession(prev => prev ? { ...prev, ...(detail || {}), messages: msgs } : detail ? { ...detail, messages: msgs } : null)
    } catch {
      setSelectedSession(prev => prev ? { ...prev, messages: [] } : null)
      setSessionAudit([])
    }
    setMsgsLoading(false)
  }

  const fetchSummary = async (sessionId: string) => {
    if (expandedSummary[sessionId] !== undefined) return
    setExpandedLoading(prev => ({ ...prev, [sessionId]: true }))
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/summary`, { headers: { Authorization: `Bearer ${getAuthToken()}` } })
      if (r.ok) {
        const d = await r.json()
        setExpandedSummary(prev => ({ ...prev, [sessionId]: d }))
      } else {
        setExpandedSummary(prev => ({ ...prev, [sessionId]: null }))
      }
    } catch {
      setExpandedSummary(prev => ({ ...prev, [sessionId]: null }))
    }
    setExpandedLoading(prev => ({ ...prev, [sessionId]: false }))
  }

  const toggleExpand = (sessionId: string) => {
    if (expandedId === sessionId) {
      setExpandedId(null)
    } else {
      setExpandedId(sessionId)
      fetchSummary(sessionId)
    }
  }

  const openSession = async (session: Session) => {
    setSelectedSession({ ...session, messages: [] })
    setInterventionMessage('')
    await fetchMessages(session.id)
  }

  const sendIntervention = async () => {
    if (!selectedSession || !interventionMessage.trim()) return
    setActionLoading('message')
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(selectedSession.id)}/message`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: interventionMessage.trim(), actor: 'admin' }),
      })
      const d = await r.json()
      if (r.ok && d.success) {
        showToast('介入消息已送达')
        setInterventionMessage('')
        await fetchMessages(selectedSession.id)
        await fetchSessions()
      } else {
        showToast(d.error || '介入失败', 'error')
      }
    } catch (e: any) {
      showToast(e.message || '介入失败', 'error')
    }
    setActionLoading(null)
  }

  const updateSessionStatus = async (status: NonNullable<Session['status']>) => {
    if (!selectedSession) return
    setActionLoading('status')
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(selectedSession.id)}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, actor: 'admin' }),
      })
      const d = await r.json()
      if (r.ok && d.success) {
        showToast(`状态已更新为 ${status}`)
        await fetchMessages(selectedSession.id)
        await fetchSessions()
      } else {
        showToast(d.error || '状态更新失败', 'error')
      }
    } catch (e: any) {
      showToast(e.message || '状态更新失败', 'error')
    }
    setActionLoading(null)
  }

  const stopSession = async () => {
    if (!selectedSession) return
    const reason = window.prompt('请输入停止原因：', '人工停止：疑似卡死')
    if (!reason) return
    setActionLoading('stop')
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(selectedSession.id)}/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, actor: 'admin' }),
      })
      const d = await r.json()
      if (r.ok && d.success) {
        showToast('会话已停止')
        await fetchMessages(selectedSession.id)
        await fetchSessions()
      } else {
        showToast(d.error || '停止失败', 'error')
      }
    } catch (e: any) {
      showToast(e.message || '停止失败', 'error')
    }
    setActionLoading(null)
  }

  useEffect(() => { fetchSessions() }, [statusFilter, errorOnly, intervenedOnly])

  const departments = [...new Set(sessions.map(s => s.agentName))].sort()

  const filtered = sessions.filter(s => {
    if (filterDept !== 'all' && s.agentName !== filterDept) return false
    if (!filter) return true
    const f = filter.toLowerCase()
    return s.agentName.toLowerCase().includes(f) || s.channel.toLowerCase().includes(f) || s.id.toLowerCase().includes(f)
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'time') return b.updatedAt - a.updatedAt
    if (sortBy === 'tokens') return (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens)
    return b.messageCount - a.messageCount
  })

  const totalTokens = sessions.reduce((s, x) => s + x.inputTokens + x.outputTokens, 0)
  const totalMessages = sessions.reduce((s, x) => s + x.messageCount, 0)
  const activeSessions = sessions.filter(s => s.status === 'active' || Date.now() - s.updatedAt < 3600000).length

  if (loading) return (
    <div className={`${sub} p-4 text-center`}>
      <div className="animate-pulse">⏳ 加载会话数据中...</div>
    </div>
  )

  return (
    <div className="space-y-4 relative">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm ${toast.type === 'success' ? (theme === 'light' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-green-500/20 border border-green-500/50 text-green-400') : (theme === 'light' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-red-500/20 border border-red-500/50 text-red-400')}`}>
          {toast.msg}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: '总会话', v: sessions.length, c: 'text-[#d4a574]' },
          { l: '活跃(1h)', v: activeSessions, c: 'text-green-400' },
          { l: '总消息', v: totalMessages, c: 'text-[#d4a574]' },
          { l: 'Token', v: fmt(totalTokens), c: 'text-[#d4a574]' },
        ].map(x => (
          <div key={x.l} className={`${bg} rounded-lg p-3`}>
            <div className={`text-[10px] sm:text-xs uppercase ${sub}`}>{x.l}</div>
            <div className={`font-mono text-lg sm:text-2xl ${x.c}`}>{x.v}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className={`px-2 py-1.5 text-xs rounded border ${theme === 'light' ? 'bg-white border-gray-300' : 'bg-[#0d0d1a] border-[#d4a574]/20'}`}>
          <option value="all">全部部门</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className={`px-2 py-1.5 text-xs rounded border ${theme === 'light' ? 'bg-white border-gray-300' : 'bg-[#0d0d1a] border-[#d4a574]/20'}`}>
          <option value="all">全部状态</option>
          <option value="active">活跃</option>
          <option value="idle">空闲</option>
          <option value="needs-human">待人工</option>
          <option value="error">异常</option>
          <option value="archived">归档</option>
        </select>
        <input type="text" placeholder="搜索..." value={filter} onChange={e => setFilter(e.target.value)} className={`flex-1 min-w-[120px] px-2 py-1.5 text-xs rounded border ${theme === 'light' ? 'bg-white border-gray-300' : 'bg-[#0d0d1a] border-[#d4a574]/20'} focus:outline-none focus:border-[#d4a574]`} />
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className={`px-2 py-1.5 text-xs rounded border ${theme === 'light' ? 'bg-white border-gray-300' : 'bg-[#0d0d1a] border-[#d4a574]/20'}`}>
          <option value="time">按时间</option>
          <option value="tokens">按Token</option>
          <option value="messages">按消息</option>
        </select>
        <label className={`flex items-center gap-1 text-xs px-2 ${sub}`}><input type="checkbox" checked={errorOnly} onChange={e => setErrorOnly(e.target.checked)} />仅异常</label>
        <label className={`flex items-center gap-1 text-xs px-2 ${sub}`}><input type="checkbox" checked={intervenedOnly} onChange={e => setIntervenedOnly(e.target.checked)} />仅已介入</label>
        <button onClick={fetchSessions} className="px-3 py-1.5 text-xs border border-[#d4a574]/30 text-[#d4a574] rounded hover:bg-[#d4a574]/10 cursor-pointer">🔄</button>
      </div>

      <div className="space-y-2">
        {sorted.length === 0 && <div className={`text-center py-8 ${sub}`}>暂无会话数据</div>}
        {sorted.map(s => {
          const tokens = s.inputTokens + s.outputTokens
          const status = sessionStatus(s)
          const isExpanded = expandedId === s.id
          const smry = expandedSummary[s.id]
          const smryLoading = expandedLoading[s.id]

          return (
            <div key={s.id} className={`${bg} rounded-lg overflow-hidden transition-all`}>
              <div className="p-3 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status.label === '活跃' ? 'bg-green-400' : status.label === '空闲' ? 'bg-yellow-400' : status.label === '待人工' ? 'bg-yellow-300' : status.label === '异常' ? 'bg-red-400' : 'bg-gray-500'}`} />
                    <span className="text-sm font-medium">{s.agentName}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${theme === 'light' ? 'bg-gray-100 text-gray-500' : 'bg-[#0d0d1a] text-[#a3a3a3]'}`}>{s.channel}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${status.bg} ${status.color}`}>{status.label}</span>
                  </div>
                  <span className={`text-[10px] sm:text-xs ${sub}`}>{relTime(s.updatedAt)}</span>
                </div>
                <div className="flex items-center gap-4 text-[10px] sm:text-xs flex-wrap">
                  <span className={sub}>💬 {s.messageCount}</span>
                  <span className="text-[#d4a574] font-mono">🔥 {fmt(tokens)}</span>
                  <span className={sub}>↓{fmt(s.inputTokens)} ↑{fmt(s.outputTokens)}</span>
                  {s.lastIntervenedAt && <span className="text-blue-300">👤 已介入 · {relTime(s.lastIntervenedAt)}</span>}
                </div>
                {s.lastError && <div className="text-[10px] sm:text-xs text-red-400 break-all">⚠ {s.lastError}</div>}
                <div className="flex items-center gap-2 mt-1">
                  <button onClick={() => toggleExpand(s.id)} className={`text-[10px] px-2 py-0.5 rounded border cursor-pointer transition-colors ${isExpanded ? 'border-[#d4a574] text-[#d4a574] bg-[#d4a574]/10' : 'border-[#d4a574]/20 text-[#d4a574]/70 hover:bg-[#d4a574]/5'}`}>{isExpanded ? '▼ 收起' : '▶ 详情'}</button>
                  <button onClick={() => openSession(s)} className="text-[10px] px-2 py-0.5 rounded border border-[#d4a574]/20 text-[#d4a574]/70 hover:bg-[#d4a574]/5 cursor-pointer">💬 接管</button>
                </div>
              </div>

              {isExpanded && (
                <div className={`px-3 pb-3 border-t ${theme === 'light' ? 'border-gray-100' : 'border-[#d4a574]/10'}`}>
                  {smryLoading ? (
                    <div className={`text-center py-3 ${sub} text-xs animate-pulse`}>加载摘要...</div>
                  ) : smry ? (
                    <div className="pt-3 space-y-2">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div><div className={`text-[9px] ${sub}`}>消息数</div><div className="font-mono text-xs">{smry.messageCount}</div></div>
                        <div><div className={`text-[9px] ${sub}`}>Token</div><div className="font-mono text-xs text-[#d4a574]">{fmt(smry.totalTokens)}</div></div>
                        <div><div className={`text-[9px] ${sub}`}>平均响应</div><div className="font-mono text-xs">{smry.avgResponseTimeSec ? `${smry.avgResponseTimeSec}s` : '-'}</div></div>
                      </div>
                      {smry.firstMessage && <div className={`p-2 rounded text-[10px] ${theme === 'light' ? 'bg-gray-50' : 'bg-[#0d0d1a]'}`}><div className={`${sub} mb-0.5`}>📌 首条消息 · {new Date(smry.firstMessage.timestamp).toLocaleString('zh-CN')}</div><div className="leading-relaxed break-all">{smry.firstMessage.preview.substring(0, 150)}{smry.firstMessage.preview.length > 150 ? '...' : ''}</div></div>}
                      {smry.lastMessage && <div className={`p-2 rounded text-[10px] ${theme === 'light' ? 'bg-gray-50' : 'bg-[#0d0d1a]'}`}><div className={`${sub} mb-0.5`}>🕐 最新消息 · {new Date(smry.lastMessage.timestamp).toLocaleString('zh-CN')}</div><div className="leading-relaxed break-all">{smry.lastMessage.preview.substring(0, 150)}{smry.lastMessage.preview.length > 150 ? '...' : ''}</div></div>}
                    </div>
                  ) : (
                    <div className={`text-center py-3 ${sub} text-xs`}>暂无摘要数据</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selectedSession && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setSelectedSession(null)}>
          <div className={`w-full sm:max-w-3xl max-h-[90vh] overflow-auto rounded-t-xl sm:rounded-lg ${theme === 'light' ? 'bg-white' : 'bg-[#1a1a2e]'}`} onClick={e => e.stopPropagation()}>
            <div className={`sticky top-0 z-10 p-3 sm:p-4 border-b flex items-center justify-between ${theme === 'light' ? 'border-gray-200 bg-white' : 'border-[#d4a574]/20 bg-[#1a1a2e]'}`}>
              <div>
                <h3 className="text-sm sm:text-base font-medium text-[#d4a574]">{selectedSession.agentName}</h3>
                <div className={`text-[10px] ${sub} mt-0.5 truncate max-w-[320px]`}>{selectedSession.id}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => exportSession(selectedSession)} className="px-2 py-1 text-[10px] border border-[#d4a574]/30 text-[#d4a574] rounded hover:bg-[#d4a574]/10 cursor-pointer" title="导出会话">📥 导出</button>
                <button onClick={() => setSelectedSession(null)} className={`w-8 h-8 flex items-center justify-center rounded-full ${sub} hover:text-[#e5e5e5] text-lg cursor-pointer`}>✕</button>
              </div>
            </div>

            <div className="p-3 sm:p-4 border-b border-[#d4a574]/10 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                <div><div className={`text-[10px] ${sub}`}>消息</div><div className="font-mono text-sm">{selectedSession.messageCount}</div></div>
                <div><div className={`text-[10px] ${sub}`}>Token</div><div className="font-mono text-sm text-[#d4a574]">{fmt(selectedSession.inputTokens + selectedSession.outputTokens)}</div></div>
                <div><div className={`text-[10px] ${sub}`}>状态</div><div className="text-sm">{sessionStatus(selectedSession).label}</div></div>
                <div><div className={`text-[10px] ${sub}`}>活跃</div><div className="text-sm">{relTime(selectedSession.updatedAt)}</div></div>
                <div><div className={`text-[10px] ${sub}`}>介入</div><div className="text-sm">{selectedSession.lastIntervenedAt ? relTime(selectedSession.lastIntervenedAt) : '-'}</div></div>
              </div>
              {selectedSession.lastError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300 break-all">⚠ {selectedSession.lastError}</div>}
              {selectedSession.messages && selectedSession.messages.length > 0 && <MessageTimeline messages={selectedSession.messages} />}
            </div>

            <div className="p-3 sm:p-4 border-b border-[#d4a574]/10 space-y-3">
              <h4 className="text-xs font-medium text-[#d4a574]">人工接管</h4>
              <textarea value={interventionMessage} onChange={e => setInterventionMessage(e.target.value)} placeholder="输入介入消息，例如：停止继续调用工具，先汇报当前阻塞点。" className={`w-full min-h-[90px] px-3 py-2 text-sm rounded border ${theme === 'light' ? 'bg-gray-50 border-gray-200' : 'bg-[#0d0d1a] border-[#d4a574]/20'} focus:outline-none focus:border-[#d4a574]`} />
              <div className="flex flex-wrap gap-2">
                <button onClick={sendIntervention} disabled={actionLoading === 'message' || !interventionMessage.trim()} className="px-3 py-2 text-xs border border-[#d4a574]/30 text-[#d4a574] rounded hover:bg-[#d4a574]/10 cursor-pointer disabled:opacity-50">{actionLoading === 'message' ? '发送中...' : '发送介入消息'}</button>
                <button onClick={() => updateSessionStatus('needs-human')} disabled={!!actionLoading} className="px-3 py-2 text-xs border border-yellow-500/30 text-yellow-300 rounded hover:bg-yellow-500/10 cursor-pointer disabled:opacity-50">标记待人工</button>
                <button onClick={() => updateSessionStatus('active')} disabled={!!actionLoading} className="px-3 py-2 text-xs border border-green-500/30 text-green-400 rounded hover:bg-green-500/10 cursor-pointer disabled:opacity-50">标记活跃</button>
                <button onClick={() => updateSessionStatus('error')} disabled={!!actionLoading} className="px-3 py-2 text-xs border border-red-500/30 text-red-400 rounded hover:bg-red-500/10 cursor-pointer disabled:opacity-50">标记异常</button>
                <button onClick={stopSession} disabled={!!actionLoading} className="px-3 py-2 text-xs border border-red-500/50 text-red-400 rounded hover:bg-red-500/10 cursor-pointer disabled:opacity-50">{actionLoading === 'stop' ? '停止中...' : '停止会话'}</button>
                {onOpenAudit && <button onClick={() => onOpenAudit(selectedSession.id)} disabled={!!actionLoading} className="px-3 py-2 text-xs border border-blue-500/30 text-blue-300 rounded hover:bg-blue-500/10 cursor-pointer disabled:opacity-50">查看审计</button>}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_0.8fr] gap-0">
              <div className="p-3 sm:p-4 border-r border-[#d4a574]/10">
                <h4 className={`text-xs font-medium text-[#d4a574] mb-2`}>消息历史</h4>
                {msgsLoading ? (
                  <div className={`text-center py-4 ${sub} text-sm animate-pulse`}>加载中...</div>
                ) : selectedSession.messages?.length ? (
                  <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                    {selectedSession.messages.map(msg => (
                      <div key={msg.id} className={`p-2.5 rounded text-xs ${theme === 'light' ? 'bg-gray-50' : 'bg-[#0d0d1a]'}`}>
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${msg.role === 'user' ? 'bg-blue-500/20 text-blue-400' : msg.role === 'assistant' ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-300'}`}>{msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : (msg.toolName || '工具')}</span>
                          <span className={`text-[10px] ${sub}`}>{new Date(msg.timestamp).toLocaleString('zh-CN')}</span>
                        </div>
                        <div className="text-xs leading-relaxed break-all whitespace-pre-wrap">{msg.content?.substring(0, 800)}{msg.content?.length > 800 ? '...' : ''}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`text-center py-4 ${sub} text-sm`}>暂无消息记录</div>
                )}
              </div>

              <div className="p-3 sm:p-4">
                <h4 className={`text-xs font-medium text-[#d4a574] mb-2`}>最近审计</h4>
                {sessionAudit.length === 0 ? (
                  <div className={`text-center py-4 ${sub} text-sm`}>暂无审计记录</div>
                ) : (
                  <div className="space-y-2 max-h-[360px] overflow-y-auto">
                    {sessionAudit.map(item => (
                      <div key={item.id} className={`p-2 rounded text-xs ${theme === 'light' ? 'bg-gray-50' : 'bg-[#0d0d1a]'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#d4a574]">{item.action}</span>
                          <span className={sub}>{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                        </div>
                        <div className={`mt-1 ${sub}`}>{item.actor}</div>
                        {item.after && <pre className="mt-1 whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(item.after, null, 2)}</pre>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

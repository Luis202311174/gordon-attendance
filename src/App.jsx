import { useEffect, useMemo, useState } from 'react'
import { MIN_STAY_MINUTES, ROSTER, SEED_SESSIONS } from './config'

const tz = 'Asia/Manila'
const fmtTime = (t) => t ? new Date(t).toLocaleTimeString('en-PH', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
const fmtDate = (t) => new Date(t).toLocaleDateString('en-PH', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m` }

export default function App() {
  const [now, setNow] = useState(Date.now())
  const [sessions, setSessions] = useState(SEED_SESSIONS)
  const [denied, setDenied] = useState([])
  const [input, setInput] = useState('')
  const [result, setResult] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const submit = (e) => {
    e.preventDefault()
    const id = input.trim()
    if (!id) return
    const student = ROSTER.find((s) => s.id === id)
    if (!student) {
      setDenied((d) => [{ id, at: Date.now() }, ...d])
      setResult({ kind: 'denied', title: 'Access denied', msg: `Student number ${id} is not on the BSIT 4D roster.` })
    } else {
      const active = sessions.find((s) => s.studentId === id && !s.timeOut)
      if (!active) {
        setSessions((x) => [...x, { id: 's' + Date.now(), studentId: id, timeIn: Date.now(), timeOut: null }])
        setResult({ kind: 'in', title: 'Time in recorded', msg: `${student.name} is now timed in.` })
      } else {
        const wait = MIN_STAY_MINUTES * 60000 - (Date.now() - active.timeIn)
        if (wait > 0) setResult({ kind: 'denied', title: 'Time out denied', msg: `${student.name} must stay at least ${MIN_STAY_MINUTES} minutes. Try again in ${fmtDur(wait).replace(/^0h /, '')}.` })
        else {
          setSessions((x) => x.map((s) => (s.id === active.id ? { ...s, timeOut: Date.now() } : s)))
          setResult({ kind: 'out', title: 'Time out successful', msg: `${student.name} has timed out.` })
        }
      }
    }
    setInput('')
  }

  const rows = useMemo(() => ROSTER.map((st) => {
    const mine = sessions.filter((s) => s.studentId === st.id).sort((a, b) => a.timeIn - b.timeIn)
    const last = mine[mine.length - 1]
    const status = !last ? 'absent' : last.timeOut ? 'out' : 'in'
    const total = mine.reduce((sum, s) => sum + ((s.timeOut || now) - s.timeIn), 0)
    return { ...st, last, status, count: mine.length, total }
  }), [sessions, now])

  const stats = {
    total: ROSTER.length,
    in: rows.filter((r) => r.status === 'in').length,
    out: rows.filter((r) => r.status === 'out').length,
    left: rows.filter((r) => r.status === 'absent').length,
  }
  const label = { in: 'Timed in', out: 'Timed out', absent: 'Not logged' }
  const shown = rows.filter((r) => (filter === 'all' || r.status === filter) &&
    (r.name + r.id).toLowerCase().includes(query.toLowerCase()))

  const exportCsv = () => {
    const lines = [['Student ID', 'Name', 'Time In', 'Time Out', 'Duration', 'Status']]
    sessions.forEach((s) => {
      const st = ROSTER.find((r) => r.id === s.studentId)
      lines.push([s.studentId, st.name, fmtTime(s.timeIn), fmtTime(s.timeOut), fmtDur((s.timeOut || now) - s.timeIn), s.timeOut ? 'Timed out' : 'Timed in'])
    })
    rows.filter((r) => r.status === 'absent').forEach((r) => lines.push([r.id, r.name, '', '', '', 'Not logged']))
    const csv = lines.map((l) => l.map((c) => `"${c}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `BSIT4D-attendance-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <>
      <header className="top">
        <div className="wrap top-in">
          <div className="brand-wrap">
            <img src="/gordon-logo.png" alt="Gordon College seal" className="seal" />
            <div className="brand">
              <h1>Gordon College</h1>
              <p>BSIT 4D</p>
            </div>
          </div>

          <div className="header-meta">
            <div className="live-indicator"><span className="live-dot" /> LIVE</div>
            <div className="clock">
              <strong>{fmtTime(now)}</strong>
              <span>{fmtDate(now)}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="wrap dashboard">
        <section className="stats" aria-label="Attendance summary">
          <Stat n={stats.total} t="Total Students" s="Registered students" />
          <Stat n={stats.in} t="Currently Timed In" s={`${sessions.filter((s) => !s.timeOut).length} active session(s)`} tone="gold" />
          <Stat n={stats.out} t="Timed Out" s={`${sessions.length} session(s) today`} />
          <Stat n={stats.left} t="Not Yet Logged" s="Students missing today" tone="orange" />
        </section>

        <section className="panel submit">
          <div className="section-intro">
            <h2>Record Attendance</h2>
            <p className="muted">Enter accurately your student number. Minimum stay: {MIN_STAY_MINUTES} minutes.</p>
          </div>
          <form onSubmit={submit} className="attendance-form">
            <input value={input} onChange={(e) => setInput(e.target.value)} inputMode="numeric" placeholder="Enter student number" aria-label="Student number" />
            <button className="btn gold" type="submit">Submit Attendance</button>
          </form>
          {result && <div className={`toast ${result.kind}`} role="status"><b>{result.title}.</b> {result.msg}</div>}
        </section>

        <section className="panel table-panel">
          <div className="bar">
            <h2>Attendance Records</h2>
            <div className="tools">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or ID" aria-label="Search" className="search-input" />
              <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status" className="filter-select">
                <option value="all">All statuses</option>
                <option value="in">Timed in</option>
                <option value="out">Timed out</option>
                <option value="absent">Not logged</option>
              </select>
              <button className="btn secondary" onClick={exportCsv} type="button">Export CSV</button>
            </div>
          </div>
          <div className="scroll">
            <table>
              <thead><tr><th>Student</th><th>ID</th><th>Time In</th><th>Time Out</th><th>Duration</th><th>Sessions</th><th>Status</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="name">{r.name}</td>
                    <td>{r.id}</td>
                    <td>{fmtTime(r.last?.timeIn)}</td>
                    <td>{fmtTime(r.last?.timeOut)}</td>
                    <td>{r.count ? fmtDur(r.total) : '—'}</td>
                    <td>{r.count}</td>
                    <td><span className={`pill ${r.status}`}>{label[r.status]}</span></td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan="7" className="empty">No students match. Clear the search or choose another status.</td></tr>}
              </tbody>
            </table>
          </div>
          {denied.length > 0 && <p className="muted small">{denied.length} denied attempt(s) this session, latest: {denied[0].id} at {fmtTime(denied[0].at)}</p>}
        </section>
      </main>
    </>
  )
}

function Stat({ n, t, s, tone = '' }) {
  return <div className={`stat ${tone}`}><span className="n">{n}</span><span className="t">{t}</span><span className="s">{s}</span></div>
}

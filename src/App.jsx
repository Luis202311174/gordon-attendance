
import { useEffect, useMemo, useState } from 'react'
import { MIN_STAY_MINUTES, ROSTER } from './config'
import { db, auth } from './firebase'
import {
  ref,
  onValue,
  push,
  set,
  update
} from 'firebase/database'
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth'

const tz = 'Asia/Manila'
const PAGE_SIZE = 25

// =====================================
// DATE AND TIME HELPERS
// =====================================

const toMs = (val) => {
  if (!val) return null

  if (typeof val === 'number') {
    if (val <= 0) return null
    return val < 1e11 ? val * 1000 : val
  }

  const n = Number(val)

  if (!isNaN(n) && n > 0) {
    return n < 1e11 ? n * 1000 : n
  }

  const parsed = Date.parse(val)
  return isNaN(parsed) ? null : parsed
}

const getLocalDateString = (timestamp = Date.now()) => {
  const ms = toMs(timestamp) || Date.now()

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(ms))

  const get = (type) =>
    parts.find((p) => p.type === type)?.value || ''

  return `${get('year')}-${get('month')}-${get('day')}`
}

const fmtTime = (t) => {
  const ms = toMs(t)
  if (!ms) return '—'

  return new Date(ms).toLocaleTimeString('en-PH', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

const fmtDate = (t) => {
  const ms = toMs(t)
  if (!ms) return '—'

  return new Date(ms).toLocaleDateString('en-PH', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

const fmtDur = (ms) => {
  if (!ms || isNaN(ms) || ms <= 0) return '—'

  const totalSec = Math.floor(ms / 1000)
  const hrs = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)

  if (hrs > 24) {
    const days = Math.floor(hrs / 24)
    return `${days}d ${hrs % 24}h`
  }

  return `${hrs}h ${String(mins).padStart(2, '0')}m`
}

// =====================================
// MAIN APPLICATION
// =====================================

export default function App() {

  // GENERAL STATE
  const [now, setNow] = useState(Date.now())
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dbError, setDbError] = useState(null)

  // AUTHENTICATION
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState(null)
  const [showLogin, setShowLogin] = useState(false)

  const isAdmin = !!user && !user.isAnonymous

  // FIREBASE DATA
  const [roster, setRoster] = useState(ROSTER || [])
  const [attendanceRecords, setAttendanceRecords] = useState([])
  const [deniedLogs, setDeniedLogs] = useState([])

  // ATTENDANCE INPUT
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [justSubmittedId, setJustSubmittedId] = useState(null)

  // TABLE CONTROLS
  const [selectedDate, setSelectedDate] = useState(
    () => getLocalDateString()
  )
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [activeTab, setActiveTab] = useState('attendance')
  const [currentPage, setCurrentPage] = useState(1)

  // =====================================
  // LIVE CLOCK
  // =====================================

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  // =====================================
  // RESET PAGINATION
  // =====================================

  useEffect(() => {
    setCurrentPage(1)
  }, [query, filter, selectedDate, activeTab])

  // =====================================
  // FIREBASE AUTHENTICATION
  // =====================================

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          setUser(null)
          setAuthReady(false)
          setActiveTab('attendance')

          try {
            await signInAnonymously(auth)
          } catch (error) {
            console.error(
              'Anonymous authentication failed:',
              error
            )
            setAuthError(error.message)
            setAuthReady(true)
          }

          return
        }

        setUser(currentUser)
        setAuthReady(true)

        if (!currentUser.isAnonymous) {
          setShowLogin(false)
          setAuthError(null)
        } else {
          setActiveTab('attendance')
        }
      }
    )

    return () => unsubscribe()
  }, [])

  // =====================================
  // FIREBASE REALTIME DATABASE
  // =====================================

  useEffect(() => {

    const connectedRef = ref(db, '.info/connected')

    const unsubConnected = onValue(
      connectedRef,
      (snap) => {
        setConnected(snap.val() === true)
      }
    )

    // STUDENTS
    const studentsRef = ref(db, 'students')

    const unsubStudents = onValue(
      studentsRef,
      (snapshot) => {
        const data = snapshot.val()

        if (!data) {
          setRoster([])
          return
        }

        let list = []

        if (Array.isArray(data)) {
          list = data.filter(Boolean).map((st, idx) => ({
            ...st,
            id: String(
              st.studentID ||
              st.id ||
              st.studentId ||
              st.student_id ||
              idx
            ).trim(),
            name:
              st.name ||
              st.fullName ||
              st.studentName ||
              `Student ${idx}`,
            course: st.course || 'BSIT'
          }))
        } else {
          list = Object.entries(data).map(([key, val]) => {
            if (typeof val === 'string') {
              return {
                id: String(key).trim(),
                name: val,
                course: 'BSIT'
              }
            }

            return {
              ...val,
              id: String(
                val.studentID ||
                val.id ||
                val.studentId ||
                val.student_id ||
                key
              ).trim(),
              name:
                val.name ||
                val.fullName ||
                val.studentName ||
                `Student ${key}`,
              course: val.course || 'BSIT'
            }
          })
        }

        setRoster(list)
      },
      (error) => {
        console.error('Students read error:', error)
        setDbError(error.message)
      }
    )

    // ATTENDANCE
    const attendanceRef = ref(db, 'attendance')

    const unsubAttendance = onValue(
      attendanceRef,
      (snapshot) => {
        const data = snapshot.val()

        if (data) {
          const list = Object.entries(data).map(
            ([id, val]) => ({
              id,
              ...val
            })
          )

          list.sort((a, b) => {
            const ta =
              toMs(a.timeIn) ||
              toMs(a.timestamp) ||
              0

            const tb =
              toMs(b.timeIn) ||
              toMs(b.timestamp) ||
              0

            return tb - ta
          })

          setAttendanceRecords(list)
        } else {
          setAttendanceRecords([])
        }

        setLoading(false)
        setDbError(null)
      },
      (error) => {
        console.error('Attendance read error:', error)
        setDbError(error.message)
        setLoading(false)
      }
    )

    // DENIED LOGS
    const deniedRef = ref(db, 'deniedLogs')

    const unsubDenied = onValue(
      deniedRef,
      (snapshot) => {
        const data = snapshot.val()

        if (data) {
          const list = Object.entries(data).map(
            ([id, val]) => ({
              id,
              ...val
            })
          )

          list.sort(
            (a, b) =>
              (toMs(b.timestamp) || 0) -
              (toMs(a.timestamp) || 0)
          )

          setDeniedLogs(list)
        } else {
          setDeniedLogs([])
        }
      },
      (error) => {
        // Anonymous users may not have permission.
        if (isAdmin) {
          console.warn('Denied logs read error:', error)
        }
      }
    )

    return () => {
      unsubConnected()
      unsubStudents()
      unsubAttendance()
      unsubDenied()
    }

  }, [isAdmin])

  // =====================================
  // ADMIN LOGIN
  // =====================================

  const handleLogin = async (e) => {
    e.preventDefault()

    setAuthError(null)
    setSubmitting(true)

    try {
      await signInWithEmailAndPassword(
        auth,
        authEmail.trim(),
        authPassword
      )

      setAuthEmail('')
      setAuthPassword('')
      setShowLogin(false)

    } catch (error) {
      console.error('Admin login error:', error)
      setAuthError(error.message)

    } finally {
      setSubmitting(false)
    }
  }

  // =====================================
  // ADMIN LOGOUT
  // =====================================

  const handleLogout = async () => {
    try {
      await signOut(auth)
      setResult(null)
      setShowLogin(false)

    } catch (error) {
      console.error('Sign out error:', error)
    }
  }

  // =====================================
  // SEND FIREBASE EVENT TO ESP32
  // =====================================

  const sendDeviceEvent = async (
    type,
    studentID,
    name
  ) => {

    if (!auth.currentUser) {
      console.error(
        'Cannot notify ESP32: Firebase user not authenticated'
      )
      return false
    }

    try {
      const eventRef = ref(
        db,
        'deviceEvents/latest'
      )

      await set(eventRef, {
        eventId: crypto.randomUUID(),
        type,
        studentID,
        name,
        timestamp: Date.now()
      })

      console.log(
        'ESP32 notification sent:',
        type,
        studentID
      )

      return true

    } catch (error) {
      console.error(
        'ESP32 notification failed:',
        error
      )

      return false
    }
  }

  // =====================================
  // SUBMIT STUDENT ATTENDANCE
  // =====================================

  const submit = async (e) => {
    e.preventDefault()

    if (submitting || loading || !connected || !authReady) {
      return
    }

    const id = input.trim()

    setSubmitting(true)
    setResult(null)

    try {

      // =================================
      // INVALID STUDENT ID
      // =================================

      if (!/^\d{9}$/.test(id)) {

        await sendDeviceEvent(
          'INVALID_FORMAT',
          id,
          'Invalid ID'
        )

        setResult({
          kind: 'denied',
          title: 'Invalid Student ID',
          msg: 'Please enter a valid 9-digit student number.'
        })

        return
      }

      // =================================
      // CHECK REGISTERED STUDENT
      // =================================

      const student = roster.find(
        (s) =>
          String(s.id).trim() === id ||
          String(s.studentID || '').trim() === id
      )

      // =================================
      // UNREGISTERED STUDENT
      // =================================

      if (!student) {

        try {
          const newLogRef = push(
            ref(db, 'deniedLogs')
          )

          await set(newLogRef, {
            studentID: id,
            name: 'Not Registered',
            timestamp: Date.now(),
            status: 'Access Denied',
            reason: 'Student ID Not Registered'
          })

        } catch (error) {
          console.warn(
            'Denied log could not be saved:',
            error
          )
        }

        await sendDeviceEvent(
          'DENIED',
          id,
          'Not Registered'
        )

        setResult({
          kind: 'denied',
          title: 'Access Denied',
          msg: `Student number ${id} is not registered on the BSIT 4D roster.`
        })

        return
      }

      // =================================
      // FIND ACTIVE SESSION
      // =================================

      const todayStr = getLocalDateString(Date.now())

      const activeToday = attendanceRecords.find(
        (record) => {

          const matchId =
            String(record.studentID || '').trim() === id

          const recordDate = getLocalDateString(
            record.timeIn || record.timestamp
          )

          const isOut =
            !!record.timeOut ||
            record.status === 'Timed Out'

          return (
            matchId &&
            recordDate === todayStr &&
            !isOut
          )
        }
      )

      // =================================
      // TIME IN
      // =================================

      if (!activeToday) {

        const nowTs = Date.now()

        const newRecordRef = push(
          ref(db, 'attendance')
        )

        await set(newRecordRef, {
          studentID: id,
          name: student.name,
          course: student.course || 'BSIT',
          timeIn: nowTs,
          timeOut: null,
          timestamp: nowTs,
          status: 'Present'
        })

        // Notify ESP32 only after save succeeds
        const notified = await sendDeviceEvent(
          'TIME_IN',
          id,
          student.name
        )

        if (!notified) {
          console.warn(
            'Attendance saved, but ESP32 notification failed'
          )
        }

        setSelectedDate(todayStr)
        setCurrentPage(1)
        setJustSubmittedId(id)

        setResult({
          kind: 'in',
          title: 'Time In Recorded',
          msg: `${student.name} is now timed in.${notified ? '' : ' ESP32 notification could not be delivered.'}`
        })

        return
      }

      // =================================
      // CHECK FIVE-MINUTE STAY
      // =================================

      const inTime =
        toMs(activeToday.timeIn) ||
        toMs(activeToday.timestamp)

      if (!inTime) {
        throw new Error(
          'Unable to determine TIME IN timestamp.'
        )
      }

      const wait =
        MIN_STAY_MINUTES * 60000 -
        (Date.now() - inTime)

      // =================================
      // TIME OUT DENIED
      // =================================

      if (wait > 0) {

        await sendDeviceEvent(
          'TOO_EARLY',
          id,
          student.name
        )

        setResult({
          kind: 'denied',
          title: 'Time Out Denied',
          msg: `${student.name} must stay at least ${MIN_STAY_MINUTES} minutes. Remaining: ${Math.ceil(wait / 1000)} seconds.`
        })

        return
      }

      // =================================
      // TIME OUT SUCCESSFUL
      // =================================

      const nowTs = Date.now()

      const sessionRef = ref(
        db,
        `attendance/${activeToday.id}`
      )

      await update(sessionRef, {
        timeOut: nowTs,
        status: 'Timed Out'
      })

      const notified = await sendDeviceEvent(
        'TIME_OUT',
        id,
        student.name
      )

      if (!notified) {
        console.warn(
          'TIME OUT saved, but ESP32 notification failed'
        )
      }

      setSelectedDate(todayStr)
      setCurrentPage(1)
      setJustSubmittedId(id)

      setResult({
        kind: 'out',
        title: 'Time Out Successful',
        msg: `${student.name} has timed out.${notified ? '' : ' ESP32 notification could not be delivered.'}`
      })

    } catch (error) {

      console.error('Attendance error:', error)

      setResult({
        kind: 'denied',
        title: 'Database Error',
        msg: error.message
      })

    } finally {

      setSubmitting(false)
      setInput('')
    }
  }

  // =====================================
  // DATE FILTERS
  // =====================================

  const todayStr = getLocalDateString(now)
  const isViewingToday = selectedDate === todayStr

  const filteredAttendanceByDate = useMemo(() => {
    return attendanceRecords.filter((record) => {
      if (selectedDate === 'all') return true

      const recordDate = getLocalDateString(
        record.timeIn || record.timestamp
      )

      return recordDate === selectedDate
    })
  }, [attendanceRecords, selectedDate])

  const filteredDeniedByDate = useMemo(() => {
    return deniedLogs.filter((record) => {
      if (selectedDate === 'all') return true

      return getLocalDateString(
        record.timestamp
      ) === selectedDate
    })
  }, [deniedLogs, selectedDate])

  // =====================================
  // STUDENT ATTENDANCE ROWS
  // =====================================

  const rows = useMemo(() => {

    return roster.map((student) => {

      const studentId = String(
        student.id || student.studentID || ''
      ).trim()

      const mine = filteredAttendanceByDate
        .filter(
          (record) =>
            String(record.studentID || '').trim() === studentId
        )
        .sort((a, b) => {
          const ta =
            toMs(a.timeIn) ||
            toMs(a.timestamp) ||
            0

          const tb =
            toMs(b.timeIn) ||
            toMs(b.timestamp) ||
            0

          return ta - tb
        })

      const last = mine[mine.length - 1]

      const inTime = last
        ? toMs(last.timeIn) ||
          toMs(last.timestamp)
        : null

      const outTime = last
        ? toMs(last.timeOut)
        : null

      let status = 'absent'

      if (last) {
        if (last.timeOut || last.status === 'Timed Out') {
          status = 'out'
        } else if (inTime) {
          status = 'in'
        }
      }

      let duration = 0

      if (
        status === 'out' &&
        inTime &&
        outTime &&
        outTime >= inTime
      ) {
        duration = outTime - inTime
      } else if (
        status === 'in' &&
        inTime &&
        isViewingToday
      ) {
        const elapsed = now - inTime

        if (elapsed >= 0 && elapsed < 86400000) {
          duration = elapsed
        }
      }

      const labels = {
        in: 'Timed In',
        out: 'Timed Out',
        absent: 'Not Logged'
      }

      return {
        ...student,
        id: studentId,
        name:
          student.name ||
          student.fullName ||
          `Student ${studentId}`,
        last,
        inTime,
        outTime,
        status,
        count: mine.length,
        duration,
        statusText: labels[status]
      }
    })

  }, [
    roster,
    filteredAttendanceByDate,
    now,
    isViewingToday
  ])

  // =====================================
  // DASHBOARD STATISTICS
  // =====================================

  const completedStudents = new Set(
    filteredAttendanceByDate
      .filter((record) => !!record.timeOut)
      .map((record) => String(record.studentID || ''))
  )

  const stats = {
    total: roster.length,
    in: rows.filter((r) => r.status === 'in').length,
    out: completedStudents.size,
    absent: rows.filter((r) => r.status === 'absent').length,
    denied: filteredDeniedByDate.length
  }

  // =====================================
  // SORT BY LATEST ACTIVITY
  // =====================================

  const sortedRows = useMemo(() => {

    return [...rows].sort((a, b) => {

      const aTime = a.last
        ? toMs(a.last.timeOut) ||
          toMs(a.last.timeIn) ||
          toMs(a.last.timestamp) ||
          0
        : 0

      const bTime = b.last
        ? toMs(b.last.timeOut) ||
          toMs(b.last.timeIn) ||
          toMs(b.last.timestamp) ||
          0
        : 0

      if (aTime && bTime) {
        return bTime - aTime
      }

      if (aTime) return -1
      if (bTime) return 1

      return (a.name || '').localeCompare(
        b.name || ''
      )
    })

  }, [rows])

  // =====================================
  // SEARCH AND STATUS FILTERS
  // =====================================

  const shownRows = useMemo(() => {
    return sortedRows.filter((row) => {
      const matchFilter =
        filter === 'all' || row.status === filter

      const matchQuery =
        (row.name + row.id)
          .toLowerCase()
          .includes(query.toLowerCase())

      return matchFilter && matchQuery
    })
  }, [sortedRows, filter, query])

  const shownDenied = filteredDeniedByDate.filter(
    (record) =>
      String(record.studentID || '')
        .toLowerCase()
        .includes(query.toLowerCase())
  )

  // =====================================
  // PAGINATION
  // =====================================

  const totalPages = Math.max(
    1,
    Math.ceil(shownRows.length / PAGE_SIZE)
  )

  const totalDeniedPages = Math.max(
    1,
    Math.ceil(shownDenied.length / PAGE_SIZE)
  )

  const activeTotalPages =
    activeTab === 'attendance'
      ? totalPages
      : totalDeniedPages

  const activeTotalItems =
    activeTab === 'attendance'
      ? shownRows.length
      : shownDenied.length

  const startIndex =
    (currentPage - 1) * PAGE_SIZE

  const paginatedRows = shownRows.slice(
    startIndex,
    startIndex + PAGE_SIZE
  )

  const paginatedDenied = shownDenied.slice(
    startIndex,
    startIndex + PAGE_SIZE
  )

  // =====================================
  // CSV EXPORT
  // =====================================

  const downloadFile = (content, filename) => {
    const blob = new Blob(
      [content],
      { type: 'text/csv;charset=utf-8' }
    )

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')

    a.href = url
    a.download = filename
    a.click()

    URL.revokeObjectURL(url)
  }

  const exportCsv = () => {

    if (!isAdmin) return

    const dateLabel =
      selectedDate === 'all'
        ? 'All-Dates'
        : selectedDate

    if (activeTab === 'attendance') {

      const lines = [[
        'Student ID',
        'Name',
        'Course',
        'Time In',
        'Time Out',
        'Duration',
        'Status'
      ]]

      rows.forEach((row) => {
        lines.push([
          row.id,
          row.name,
          row.course || 'BSIT',
          row.inTime
            ? `${fmtDate(row.inTime)} ${fmtTime(row.inTime)}`
            : '—',
          row.outTime
            ? `${fmtDate(row.outTime)} ${fmtTime(row.outTime)}`
            : '—',
          fmtDur(row.duration),
          row.statusText
        ])
      })

      const csv = lines
        .map((line) =>
          line.map((value) =>
            `"${String(value ?? '').replace(/"/g, '""')}"`
          ).join(',')
        )
        .join('\n')

      downloadFile(
        csv,
        `BSIT4D-attendance-${dateLabel}.csv`
      )

    } else {

      const lines = [[
        'Student ID',
        'Name',
        'Timestamp',
        'Date & Time',
        'Status',
        'Reason'
      ]]

      filteredDeniedByDate.forEach((record) => {
        lines.push([
          record.studentID,
          record.name || 'Not Registered',
          record.timestamp,
          record.timestamp
            ? `${fmtDate(record.timestamp)} ${fmtTime(record.timestamp)}`
            : '—',
          record.status,
          record.reason
        ])
      })

      const csv = lines
        .map((line) =>
          line.map((value) =>
            `"${String(value ?? '').replace(/"/g, '""')}"`
          ).join(',')
        )
        .join('\n')

      downloadFile(
        csv,
        `BSIT4D-denied-logs-${dateLabel}.csv`
      )
    }
  }

  // =====================================
  // WEBSITE INTERFACE
  // =====================================

  return (
    <>

      {/* HEADER */}
      <header className="top">
        <div className="wrap top-in">

          <div className="brand-wrap">
            <img
              src="/gordon-logo.png"
              alt="Gordon College seal"
              className="seal"
            />

            <div className="brand">
              <h1>Gordon College</h1>
              <p>BSIT 4D Attendance System</p>
            </div>
          </div>

          <div className="header-meta">

            <div className="live-indicator">
              <span
                className="live-dot"
                style={{
                  background: connected
                    ? '#7ae1a9'
                    : '#f59e0b'
                }}
              />
              {connected ? 'LIVE' : 'CONNECTING...'}
            </div>

            {/* ADMIN AUTHENTICATION */}
            {isAdmin ? (

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}
              >

                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: 'rgba(122,225,169,0.2)',
                    color: '#a7f3d0',
                    border: '1px solid rgba(255,255,255,0.2)'
                  }}
                >
                  ✓ Admin ({user.email || 'Signed In'})
                </span>

                <button
                  type="button"
                  onClick={handleLogout}
                  style={{
                    background: 'rgba(255,255,255,0.15)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff',
                    borderRadius: 6,
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    cursor: 'pointer'
                  }}
                >
                  Sign Out
                </button>

              </div>

            ) : (

              <button
                type="button"
                onClick={() => setShowLogin((v) => !v)}
                style={{
                  background: 'var(--gold)',
                  border: 'none',
                  color: '#1a2216',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {showLogin ? 'Close Login' : 'Admin Login'}
              </button>

            )}

            <div className="clock">
              <strong>{fmtTime(now)}</strong>
              <span>{fmtDate(now)}</span>
            </div>

          </div>
        </div>
      </header>

      <main className="wrap dashboard">

        {/* FIREBASE ERROR */}
        {dbError && (
          <div
            className="toast denied"
            role="alert"
            style={{ marginBottom: 16 }}
          >
            <b>Firebase Permission Warning:</b> {dbError}
          </div>
        )}

        {/* ADMIN LOGIN FORM */}
        {showLogin && !isAdmin && (

          <section
            className="panel submit"
            style={{
              borderTopColor: '#10b981',
              marginBottom: 18
            }}
          >

            <div className="section-intro">
              <h2>Admin Authentication</h2>
              <p className="muted">
                Sign in to export CSV and view denied access logs.
              </p>
            </div>

            <form
              onSubmit={handleLogin}
              className="attendance-form"
              style={{ marginTop: 12 }}
            >

              <input
                type="email"
                value={authEmail}
                onChange={(e) =>
                  setAuthEmail(e.target.value)
                }
                placeholder="Admin Email"
                required
                style={{ flex: '1 1 240px' }}
              />

              <input
                type="password"
                value={authPassword}
                onChange={(e) =>
                  setAuthPassword(e.target.value)
                }
                placeholder="Password"
                required
                style={{ flex: '1 1 200px' }}
              />

              <button
                className="btn gold"
                type="submit"
                disabled={submitting}
              >
                {submitting ? 'Signing In...' : 'Sign In'}
              </button>

            </form>

            {authError && (
              <div
                className="toast denied"
                style={{ marginTop: 12 }}
              >
                <b>Login Failed:</b> {authError}
              </div>
            )}

          </section>
        )}

        {/* DASHBOARD COUNTERS */}
        <section
          className="stats"
          aria-label="Attendance summary"
        >

          <Stat
            n={stats.total}
            t="Total Students"
            s="BSIT 4D Roster"
          />

          <Stat
            n={stats.in}
            t="Currently Timed In"
            s={`${stats.in} active session(s)`}
            tone="gold"
          />

          <Stat
            n={stats.out}
            t="Timed Out"
            s={`${stats.out} student(s) timed out`}
          />

          <Stat
            n={stats.absent}
            t="Not Yet Logged"
            s={`${stats.absent} missing today`}
            tone="orange"
          />

        </section>

        {/* STUDENT ATTENDANCE FORM */}
        <section className="panel submit">

          <div className="section-intro">
            <h2>Record Attendance</h2>
            <p className="muted">
              Enter student number to <b>Time In</b> or{' '}
              <b>Time Out</b>. Minimum stay:{' '}
              {MIN_STAY_MINUTES} minutes.
            </p>
          </div>

          <form
            onSubmit={submit}
            className="attendance-form"
          >

            <input
              value={input}
              onChange={(e) =>
                setInput(e.target.value)
              }
              inputMode="numeric"
              placeholder="Enter student number (e.g. 202310779)"
              aria-label="Student number"
              disabled={submitting}
            />

            <button
              className="btn gold"
              type="submit"
              disabled={
                submitting ||
                loading ||
                !connected ||
                !authReady
              }
            >
              {submitting
                ? 'Recording...'
                : 'Submit Attendance'}
            </button>

          </form>

          {result && (
            <div
              className={`toast ${result.kind}`}
              role="status"
            >
              <b>{result.title}.</b> {result.msg}
            </div>
          )}

        </section>

        {/* ATTENDANCE RECORDS */}
        <section className="panel table-panel">

          <div className="bar">

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap'
              }}
            >

              <h2>
                Attendance Records{' '}
                {loading && (
                  <span className="muted small">
                    (Loading...)
                  </span>
                )}
              </h2>

              {/* ADMIN TABS */}
              {isAdmin && (

                <div
                  style={{
                    display: 'inline-flex',
                    gap: 6,
                    background: '#e2ece6',
                    padding: 4,
                    borderRadius: 8
                  }}
                >

                  <button
                    type="button"
                    onClick={() =>
                      setActiveTab('attendance')
                    }
                    style={{
                      background:
                        activeTab === 'attendance'
                          ? '#fff'
                          : 'transparent',
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      color: 'var(--text)'
                    }}
                  >
                    Attendance ({filteredAttendanceByDate.length})
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setActiveTab('denied')
                    }
                    style={{
                      background:
                        activeTab === 'denied'
                          ? '#fff'
                          : 'transparent',
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      color: 'var(--text)'
                    }}
                  >
                    Denied Logs ({filteredDeniedByDate.length})
                  </button>

                </div>
              )}

            </div>

            {/* SEARCH AND FILTERS */}
            <div className="tools">

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexShrink: 0
                }}
              >

                <input
                  type="date"
                  value={
                    selectedDate === 'all'
                      ? ''
                      : selectedDate
                  }
                  onChange={(e) =>
                    setSelectedDate(
                      e.target.value || 'all'
                    )
                  }
                  aria-label="Filter date"
                  className="date-input"
                />

                {!isViewingToday && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() =>
                      setSelectedDate(todayStr)
                    }
                    style={{
                      padding: '6px 10px',
                      height: 42,
                      fontSize: '0.8rem',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Today
                  </button>
                )}

              </div>

              <input
                value={query}
                onChange={(e) =>
                  setQuery(e.target.value)
                }
                placeholder="Search name or ID"
                aria-label="Search"
                className="search-input"
              />

              {activeTab === 'attendance' && (

                <select
                  value={filter}
                  onChange={(e) =>
                    setFilter(e.target.value)
                  }
                  aria-label="Filter by status"
                  className="filter-select"
                >
                  <option value="all">All statuses</option>
                  <option value="in">Timed In</option>
                  <option value="out">Timed Out</option>
                  <option value="absent">Not Logged</option>
                </select>

              )}

              {/* ADMIN CSV EXPORT */}
              {isAdmin && (
                <button
                  className="btn secondary"
                  onClick={exportCsv}
                  type="button"
                  style={{
                    height: 42,
                    padding: '0 14px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0
                  }}
                >
                  Export CSV
                </button>
              )}

            </div>
          </div>

          {/* TABLE */}
          <div className="scroll">

            {activeTab === 'attendance' ? (

              <table>

                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Student ID</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Duration</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>

                  {paginatedRows.map((row) => (
                    <tr
                      key={row.id}
                      className={
                        row.id === justSubmittedId
                          ? 'highlighted'
                          : ''
                      }
                    >

                      <td className="name">
                        {row.name}
                      </td>

                      <td>{row.id}</td>
                      <td>{fmtTime(row.inTime)}</td>
                      <td>{fmtTime(row.outTime)}</td>
                      <td>{fmtDur(row.duration)}</td>

                      <td>
                        <span
                          className={`pill ${row.status}`}
                        >
                          {row.statusText}
                        </span>
                      </td>

                    </tr>
                  ))}

                  {!shownRows.length && (
                    <tr>
                      <td
                        colSpan="6"
                        className="empty"
                      >
                        No students match your filter or search query for this date.
                      </td>
                    </tr>
                  )}

                </tbody>
              </table>

            ) : (

              <table>

                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Time Attempted</th>
                    <th>Reason</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>

                  {paginatedDenied.map((record) => (
                    <tr key={record.id}>

                      <td>
                        <b>{record.studentID}</b>
                      </td>

                      <td>
                        {record.name || 'Not Registered'}
                      </td>

                      <td>
                        {fmtDate(record.timestamp)}{' '}
                        {fmtTime(record.timestamp)}
                      </td>

                      <td>
                        {record.reason ||
                          'Student ID Not Registered'}
                      </td>

                      <td>
                        <span className="pill absent">
                          {record.status ||
                            'Access Denied'}
                        </span>
                      </td>

                    </tr>
                  ))}

                  {!shownDenied.length && (
                    <tr>
                      <td
                        colSpan="5"
                        className="empty"
                      >
                        No denied attempts recorded for this date.
                      </td>
                    </tr>
                  )}

                </tbody>
              </table>

            )}

          </div>

          {/* PAGINATION */}
          <div className="pagination-bar">

            <div className="pagination-info">
              Showing{' '}
              <b>
                {activeTotalItems
                  ? startIndex + 1
                  : 0}
              </b>
              {' '}to{' '}
              <b>
                {Math.min(
                  startIndex + PAGE_SIZE,
                  activeTotalItems
                )}
              </b>
              {' '}of{' '}
              <b>{activeTotalItems}</b>
              {' '}
              {activeTab === 'attendance'
                ? 'students'
                : 'logs'}
            </div>

            {activeTotalPages > 1 && (

              <div className="pagination-controls">

                <button
                  type="button"
                  className="btn-page"
                  disabled={currentPage === 1}
                  onClick={() =>
                    setCurrentPage((p) =>
                      Math.max(1, p - 1)
                    )
                  }
                >
                  ‹ Prev
                </button>

                {Array.from(
                  { length: activeTotalPages },
                  (_, i) => i + 1
                ).map((pageNum) => (

                  <button
                    key={pageNum}
                    type="button"
                    className={`btn-page ${
                      currentPage === pageNum
                        ? 'active'
                        : ''
                    }`}
                    onClick={() =>
                      setCurrentPage(pageNum)
                    }
                  >
                    {pageNum}
                  </button>

                ))}

                <button
                  type="button"
                  className="btn-page"
                  disabled={
                    currentPage === activeTotalPages
                  }
                  onClick={() =>
                    setCurrentPage((p) =>
                      Math.min(
                        activeTotalPages,
                        p + 1
                      )
                    )
                  }
                >
                  Next ›
                </button>

              </div>
            )}

          </div>

        </section>
      </main>
    </>
  )
}

// =====================================
// STATISTICS CARD COMPONENT
// =====================================

function Stat({ n, t, s, tone = '' }) {
  return (
    <div className={`stat ${tone}`}>
      <span className="n">{n}</span>
      <span className="t">{t}</span>
      <span className="s">{s}</span>
    </div>
  )
}

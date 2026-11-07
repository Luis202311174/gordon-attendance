// Phase 1: sample data only. Phase 2 replaces ROSTER and sessions with Firebase reads.
export const MIN_STAY_MINUTES = 5

export const ROSTER = [
  { id: '202310779', name: 'Bianca Reyes' },
  { id: '202310112', name: 'Carlo Mendoza' },
  { id: '202310245', name: 'Diane Santos' },
  { id: '202310318', name: 'Emil Bautista' },
  { id: '202310457', name: 'Frances Dela Cruz' },
  { id: '202310566', name: 'Gerard Villanueva' },
  { id: '202310623', name: 'Hannah Ramos' },
  { id: '202310834', name: 'Ivan Navarro' },
]

const ago = (min) => Date.now() - min * 60000
export const SEED_SESSIONS = [
  { id: 's1', studentId: '202310779', timeIn: ago(42), timeOut: ago(20) },
  { id: 's2', studentId: '202310779', timeIn: ago(12), timeOut: null },
  { id: 's3', studentId: '202310112', timeIn: ago(35), timeOut: null },
  { id: 's4', studentId: '202310245', timeIn: ago(50), timeOut: ago(30) },
]

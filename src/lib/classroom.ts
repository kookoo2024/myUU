import { ALL_STUDENTS } from '../data/demo'
import type { Classroom, ClassroomDirectory, Student } from '../types'
import {
  CLASSROOM_DIRECTORY_STORAGE_KEY,
  CLASSROOM_STORAGE_KEY,
} from './storageKeys'
import { syncClassroomDirectoryToServer } from './serverSync'

export const MAX_CLASSROOMS = 30
export const MAX_STUDENTS = 80

export const DEFAULT_CLASSROOM: Classroom = {
  id: 'class-demo',
  name: '高二（3）班',
  students: ALL_STUDENTS,
}

export const DEFAULT_CLASSROOM_DIRECTORY: ClassroomDirectory = {
  version: 1,
  activeClassId: DEFAULT_CLASSROOM.id,
  classrooms: [DEFAULT_CLASSROOM],
}

export function createClassroomId() {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `class-${Date.now()}-${randomPart}`
}

export function parseRosterText(text: string, classId = 'class'): Student[] {
  const seenIds = new Set<string>()
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[，,、]/))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d{1,3}\s*[.、:：\-\s]*/, '').trim())
    .filter(Boolean)
    .map((name, index) => {
      let id = `${classId}-s${String(index + 1).padStart(2, '0')}`
      while (seenIds.has(id)) id = `${id}-${index + 1}`
      seenIds.add(id)
      return {
        id,
        number: index + 1,
        name,
      }
    })
}

function isStudent(value: unknown): value is Student {
  if (!value || typeof value !== 'object') return false
  const student = value as Partial<Student>
  return (
    typeof student.id === 'string' &&
    typeof student.number === 'number' &&
    typeof student.name === 'string' &&
    student.name.trim().length > 0
  )
}

function normalizeClassroom(value: unknown, fallbackId: string): Classroom | null {
  if (!value || typeof value !== 'object') return null
  const classroom = value as Partial<Classroom>
  if (
    typeof classroom.name !== 'string' ||
    !classroom.name.trim() ||
    !Array.isArray(classroom.students) ||
    classroom.students.length === 0 ||
    classroom.students.length > MAX_STUDENTS ||
    !classroom.students.every(isStudent)
  ) {
    return null
  }

  const id =
    typeof classroom.id === 'string' && classroom.id.trim()
      ? classroom.id.trim()
      : fallbackId
  return {
    id,
    name: classroom.name.trim().slice(0, 24),
    students: classroom.students.map((student, index) => ({
      ...student,
      id: student.id || `${id}-s${String(index + 1).padStart(2, '0')}`,
      number: index + 1,
      name: student.name.trim().slice(0, 20),
    })),
  }
}

export function normalizeClassroomDirectory(value: unknown): ClassroomDirectory | null {
  if (!value || typeof value !== 'object') return null
  const directory = value as Partial<ClassroomDirectory>
  if (!Array.isArray(directory.classrooms)) return null

  const seenIds = new Set<string>()
  const classrooms = directory.classrooms
    .map((classroom, index) => normalizeClassroom(classroom, `class-${index + 1}`))
    .filter((classroom): classroom is Classroom => classroom !== null)
    .slice(0, MAX_CLASSROOMS)
    .filter((classroom) => {
      if (seenIds.has(classroom.id)) return false
      seenIds.add(classroom.id)
      return true
    })

  if (classrooms.length === 0) return null
  const activeClassId =
    typeof directory.activeClassId === 'string' &&
    classrooms.some((classroom) => classroom.id === directory.activeClassId)
      ? directory.activeClassId
      : classrooms[0].id

  return {
    version: 1,
    activeClassId,
    classrooms,
  }
}

export function loadClassroomDirectory(): ClassroomDirectory {
  try {
    const savedDirectory = window.localStorage.getItem(CLASSROOM_DIRECTORY_STORAGE_KEY)
    if (savedDirectory) {
      const parsed = normalizeClassroomDirectory(JSON.parse(savedDirectory) as unknown)
      if (parsed) return parsed
    }
  } catch {
    // Fall through to the legacy single-class store.
  }

  try {
    const savedClassroom = window.localStorage.getItem(CLASSROOM_STORAGE_KEY)
    if (savedClassroom) {
      const legacy = normalizeClassroom(JSON.parse(savedClassroom) as unknown, 'class-demo')
      if (legacy) {
        return {
          version: 1,
          activeClassId: legacy.id,
          classrooms: [legacy],
        }
      }
    }
  } catch {
    // Use the bundled demo class if both stores are invalid.
  }

  return DEFAULT_CLASSROOM_DIRECTORY
}

export function getActiveClassroom(directory: ClassroomDirectory): Classroom {
  return (
    directory.classrooms.find((classroom) => classroom.id === directory.activeClassId) ??
    directory.classrooms[0]
  )
}

export function saveClassroomDirectory(directory: ClassroomDirectory) {
  const normalized = normalizeClassroomDirectory(directory) ?? DEFAULT_CLASSROOM_DIRECTORY
  const activeClassroom = getActiveClassroom(normalized)
  window.localStorage.setItem(
    CLASSROOM_DIRECTORY_STORAGE_KEY,
    JSON.stringify(normalized),
  )
  // Keep the v1 key populated so an older build still opens the current class.
  window.localStorage.setItem(CLASSROOM_STORAGE_KEY, JSON.stringify(activeClassroom))
  syncClassroomDirectoryToServer(normalized)
}

export function directoryFromLegacyClassroom(classroom: Classroom): ClassroomDirectory {
  return {
    version: 1,
    activeClassId: classroom.id,
    classrooms: [classroom],
  }
}

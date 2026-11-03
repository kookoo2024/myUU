import { useEffect, useMemo, useState } from 'react'
import {
  MAX_CLASSROOMS,
  MAX_STUDENTS,
  createClassroomId,
  parseRosterText,
} from '../lib/classroom'
import type { Classroom, ClassroomDirectory, Student } from '../types'

interface ClassroomManagerProps {
  directory: ClassroomDirectory
  onSave: (directory: ClassroomDirectory) => void
  onClose: () => void
}

function rosterText(classroom: Classroom) {
  return classroom.students.map((student) => student.name).join('\n')
}

function newClassroom(index: number): Classroom {
  const id = createClassroomId()
  const student: Student = {
    id: `${id}-s01`,
    number: 1,
    name: '新同学',
  }
  return {
    id,
    name: `新班级 ${index}`,
    students: [student],
  }
}

export function ClassroomManager({
  directory,
  onSave,
  onClose,
}: ClassroomManagerProps) {
  const [classrooms, setClassrooms] = useState<Classroom[]>(directory.classrooms)
  const [activeClassId, setActiveClassId] = useState(directory.activeClassId)
  const activeClassroom =
    classrooms.find((classroom) => classroom.id === activeClassId) ?? classrooms[0]
  const [className, setClassName] = useState(activeClassroom.name)
  const [roster, setRoster] = useState(rosterText(activeClassroom))
  const [deletePending, setDeletePending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const students = useMemo(
    () => parseRosterText(roster, activeClassId),
    [activeClassId, roster],
  )
  const canSaveCurrent =
    className.trim().length > 0 &&
    students.length > 0 &&
    students.length <= MAX_STUDENTS

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (deletePending) {
        setDeletePending(false)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deletePending, onClose])

  useEffect(() => {
    if (!canSaveCurrent) return
    setClassrooms((current) =>
      current.map((classroom) =>
        classroom.id === activeClassId
          ? {
              ...classroom,
              name: className.trim(),
              students,
            }
          : classroom,
      ),
    )
  }, [activeClassId, canSaveCurrent, className, students])

  const commitCurrentClassroom = () => {
    if (!canSaveCurrent) return classrooms
    return classrooms.map((classroom) =>
      classroom.id === activeClassId
        ? {
            ...classroom,
            name: className.trim(),
            students,
          }
        : classroom,
    )
  }

  const selectClassroom = (classroom: Classroom) => {
    if (classroom.id === activeClassId) return
    if (!canSaveCurrent) {
      setError('请先补全当前班级名称和至少一名学生，再切换班级。')
      return
    }
    const nextClassrooms = commitCurrentClassroom()
    const target = nextClassrooms.find((item) => item.id === classroom.id) ?? classroom
    setClassrooms(nextClassrooms)
    setActiveClassId(target.id)
    setClassName(target.name)
    setRoster(rosterText(target))
    setDeletePending(false)
    setError(null)
  }

  const addClassroom = () => {
    if (!canSaveCurrent) {
      setError('请先补全当前班级信息，再新增班级。')
      return
    }
    if (classrooms.length >= MAX_CLASSROOMS) {
      setError(`最多可管理 ${MAX_CLASSROOMS} 个班级。`)
      return
    }
    const nextClassrooms = [...commitCurrentClassroom(), newClassroom(classrooms.length + 1)]
    const created = nextClassrooms[nextClassrooms.length - 1]
    setClassrooms(nextClassrooms)
    setActiveClassId(created.id)
    setClassName(created.name)
    setRoster(rosterText(created))
    setDeletePending(false)
    setError(null)
  }

  const duplicateClassroom = () => {
    if (!canSaveCurrent) {
      setError('请先补全当前班级信息，再复制班级。')
      return
    }
    if (classrooms.length >= MAX_CLASSROOMS) {
      setError(`最多可管理 ${MAX_CLASSROOMS} 个班级。`)
      return
    }
    const id = createClassroomId()
    const duplicated: Classroom = {
      id,
      name: `${className.trim().slice(0, 20)} 副本`,
      students: students.map((student, index) => ({
        id: `${id}-s${String(index + 1).padStart(2, '0')}`,
        number: index + 1,
        name: student.name,
      })),
    }
    const nextClassrooms = [...commitCurrentClassroom(), duplicated]
    setClassrooms(nextClassrooms)
    setActiveClassId(duplicated.id)
    setClassName(duplicated.name)
    setRoster(rosterText(duplicated))
    setDeletePending(false)
    setError(null)
  }

  const deleteClassroom = () => {
    if (classrooms.length <= 1) {
      setError('至少需要保留一个班级。')
      return
    }
    if (!deletePending) {
      setDeletePending(true)
      return
    }

    const nextClassrooms = classrooms.filter((classroom) => classroom.id !== activeClassId)
    const nextActive = nextClassrooms[0]
    setClassrooms(nextClassrooms)
    setActiveClassId(nextActive.id)
    setClassName(nextActive.name)
    setRoster(rosterText(nextActive))
    setDeletePending(false)
    setError(null)
  }

  const handleSave = () => {
    if (!canSaveCurrent || classrooms.length === 0) return
    const nextClassrooms = commitCurrentClassroom()
    const exists = nextClassrooms.some((classroom) => classroom.id === activeClassId)
    onSave({
      version: 1,
      activeClassId: exists ? activeClassId : nextClassrooms[0].id,
      classrooms: nextClassrooms,
    })
  }

  return (
    <div className="class-manager-backdrop" role="presentation">
      <section
        className="class-manager-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-manager-title"
      >
        <header className="class-manager-header">
          <div>
            <span>CLASS WORKSPACE · 本机班级资产</span>
            <h1 id="class-manager-title">班级与学生工作区</h1>
            <p>一个老师可管理多个班级；切换班级不会混用名单。</p>
          </div>
          <div className="class-manager-summary" aria-label="班级工作区概况">
            <div>
              <strong>{classrooms.length}</strong>
              <span>个班级</span>
            </div>
            <div>
              <strong>{students.length}</strong>
              <span>当前学生</span>
            </div>
            <button type="button" className="manager-close" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>

        <div className="class-manager-body">
          <aside className="class-manager-rail">
            <div className="class-rail-heading">
              <div>
                <span>MY CLASSES</span>
                <strong>班级列表</strong>
              </div>
              <button type="button" onClick={addClassroom}>
                + 新增
              </button>
            </div>

            <div className="class-rail-list">
              {classrooms.map((classroom, index) => (
                <button
                  key={classroom.id}
                  type="button"
                  aria-label={`切换班级：${classroom.name}`}
                  className={classroom.id === activeClassId ? 'is-active' : ''}
                  onClick={() => selectClassroom(classroom)}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{classroom.name}</strong>
                    <small>{classroom.students.length} 人 · 学号已排序</small>
                  </div>
                  <i>{classroom.id === activeClassId ? '编辑中' : '打开'}</i>
                </button>
              ))}
            </div>

            <div className="class-rail-tools">
              <button type="button" onClick={duplicateClassroom}>
                复制当前班级
              </button>
              <button
                type="button"
                className={deletePending ? 'is-danger' : ''}
                disabled={classrooms.length <= 1}
                onClick={deleteClassroom}
              >
                {deletePending ? '确认删除' : '删除班级'}
              </button>
            </div>
          </aside>

          <div className="class-manager-form">
            <div className="class-editor-heading">
              <span>CLASS PROFILE</span>
              <strong>当前班级资料</strong>
            </div>

            <label className="manager-field">
              <span>班级名称</span>
              <input
                value={className}
                onChange={(event) => {
                  setClassName(event.target.value)
                  setError(null)
                }}
                maxLength={24}
                placeholder="例如：高二（3）班"
              />
            </label>

            <label className="manager-field manager-field--roster">
              <span>全班名单</span>
              <textarea
                value={roster}
                onChange={(event) => {
                  setRoster(event.target.value)
                  setError(null)
                }}
                spellCheck={false}
                placeholder={'江屿\n程一诺\n欧阳子墨\n……'}
              />
            </label>

            <div className="manager-form-footer">
              <span className={students.length > MAX_STUDENTS ? 'is-warning' : ''}>
                已识别 <strong>{students.length}</strong> 人
                {students.length > MAX_STUDENTS
                  ? ` · 每班最多 ${MAX_STUDENTS} 人`
                  : ' · 学号将自动重排'}
              </span>
              <button
                type="button"
                className="manager-secondary"
                onClick={() => {
                  setClassName('高二（3）班')
                  setRoster(['江屿', '程一诺', '夏禾', '欧阳子墨', '上官若溪'].join('\n'))
                  setError(null)
                }}
              >
                填入示例
              </button>
            </div>

            <div className={`class-editor-message ${error ? 'is-error' : ''}`} aria-live="polite">
              {error ?? '名单只保存在本机；服务端在线时自动写入 SQLite。'}
            </div>
          </div>

          <aside className="class-manager-preview">
            <div className="manager-preview-heading">
              <div>
                <span>ROSTER PREVIEW</span>
                <strong>{className.trim() || '未命名班级'}</strong>
              </div>
              <span>{students.length} 人</span>
            </div>

            <div className="manager-preview-grid">
              {students.map((student) => (
                <div key={student.id}>
                  <span>{String(student.number).padStart(2, '0')}</span>
                  <strong>{student.name}</strong>
                </div>
              ))}
            </div>

            <div className="manager-preview-note">
              <span className="pulse-dot" />
              <p>课堂只会读取当前班级；切换班级后，选手选择会自动清空。</p>
            </div>
          </aside>
        </div>

        <footer className="class-manager-actions">
          <span className="class-manager-dirty-note">
            点击“保存工作区”后，班级列表和当前班级才会生效。
          </span>
          <button type="button" className="manager-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="manager-primary"
            disabled={!canSaveCurrent}
            onClick={handleSave}
          >
            保存工作区
          </button>
        </footer>
      </section>
    </div>
  )
}

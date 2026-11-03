import { useCallback, useEffect, useState } from 'react'
import type {
  ClassroomDirectory,
  MatchResult,
  MatchSettings,
  PackDefinition,
  PlayerSide,
  Student,
} from './types'
import { primeSpeechEngine } from './lib/speech'
import { randomItem } from './lib/random'
import {
  getActiveClassroom,
  loadClassroomDirectory,
  saveClassroomDirectory,
} from './lib/classroom'
import { clearAppliedPack, loadAppliedPack, markPackApplied } from './lib/packDrafts'
import { PACKS } from './data/demo'
import { SetupScreen } from './components/SetupScreen'
import { CountdownScreen } from './components/CountdownScreen'
import { DuelArena } from './components/DuelArena'
import { ResultScreen } from './components/ResultScreen'
import { TouchTest } from './components/TouchTest'
import { ClassroomManager } from './components/ClassroomManager'
import { QuestionBankManager } from './components/QuestionBankManager'
import { PracticeRecords } from './components/PracticeRecords'
import { ServerAdminPanel } from './components/ServerAdminPanel'

type Phase = 'setup' | 'countdown' | 'duel' | 'result'

interface AppProps {
  onLogout?: () => Promise<void> | void
}

const DEFAULT_SETTINGS: MatchSettings = {
  subject: 'math',
  questionCount: 6,
  secondsPerQuestion: 30,
  questionMode: 'same',
  shuffleOptions: true,
}

function App({ onLogout }: AppProps) {
  const [phase, setPhase] = useState<Phase>('setup')
  const [classroomDirectory, setClassroomDirectory] = useState<ClassroomDirectory>(
    () => loadClassroomDirectory(),
  )
  const classroom = getActiveClassroom(classroomDirectory)
  const [customPack, setCustomPack] = useState<PackDefinition | null>(() => loadAppliedPack())
  const [settings, setSettings] = useState<MatchSettings>(() => {
    const appliedPack = loadAppliedPack()
    return appliedPack
      ? {
          ...DEFAULT_SETTINGS,
          subject: appliedPack.subject,
          questionCount: appliedPack.defaultQuestionCount,
          secondsPerQuestion: appliedPack.defaultSeconds,
        }
      : DEFAULT_SETTINGS
  })
  const [matchSettings, setMatchSettings] = useState<MatchSettings>(DEFAULT_SETTINGS)
  const [selected, setSelected] = useState<{ left: Student | null; right: Student | null }>({
    left: null,
    right: null,
  })
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [showClassManager, setShowClassManager] = useState(false)
  const [showQuestionBank, setShowQuestionBank] = useState(false)
  const [showPracticeRecords, setShowPracticeRecords] = useState(false)
  const [showServerAdmin, setShowServerAdmin] = useState(false)
  const activePack =
    customPack?.subject === settings.subject ? customPack : PACKS[settings.subject]

  useEffect(() => {
    saveClassroomDirectory(classroomDirectory)
  }, [classroomDirectory])

  const clearSelection = useCallback(() => {
    setSelected({ left: null, right: null })
    setSelectionError(null)
  }, [])

  const handlePickName = (side: PlayerSide, student: Student) => {
    const otherSide = side === 'left' ? 'right' : 'left'
    if (selected[otherSide]?.id === student.id) {
      setSelectionError(`${student.name} 已经被选中`)
      return
    }

    setSelectionError(null)
    setSelected((current) => ({
      ...current,
      [side]: student,
    }))
  }

  const handleRandomPair = () => {
    if (classroom.students.length < 2) {
      setSelectionError('至少需要两名学生才能开始 PK')
      return
    }

    const first = randomItem(classroom.students)
    let second = randomItem(classroom.students)
    while (second.id === first.id) {
      second = randomItem(classroom.students)
    }
    setSelectionError(null)
    setSelected({ left: first, right: second })
  }

  const startCountdown = useCallback(() => {
    void primeSpeechEngine()
    setMatchSettings({ ...settings })
    setPhase('countdown')
  }, [settings])

  useEffect(() => {
    if (
      phase !== 'setup' ||
      showDiagnostics ||
      showClassManager ||
      showQuestionBank ||
      showPracticeRecords ||
      showServerAdmin ||
      !selected.left ||
      !selected.right
    ) {
      return
    }

    const timer = window.setTimeout(startCountdown, 650)
    return () => window.clearTimeout(timer)
  }, [
    phase,
    selected,
    settings,
    showDiagnostics,
    showClassManager,
    showQuestionBank,
    showPracticeRecords,
    showServerAdmin,
    startCountdown,
  ])

  const handleCountdownComplete = useCallback(() => {
    setPhase('duel')
  }, [])

  const handleFinish = (nextResult: MatchResult) => {
    setResult(nextResult)
    setPhase('result')
  }

  const handleReplay = () => {
    setResult(null)
    startCountdown()
  }

  const handleNextMatch = () => {
    setResult(null)
    clearSelection()
    setPhase('setup')
  }

  const handleBackToSetup = () => {
    setResult(null)
    clearSelection()
    setPhase('setup')
  }

  const handleSaveClassrooms = (nextDirectory: ClassroomDirectory) => {
    setClassroomDirectory(nextDirectory)
    clearSelection()
    setShowClassManager(false)
  }

  const handleActivateClassroom = (classId: string) => {
    if (classId === classroomDirectory.activeClassId) return
    setClassroomDirectory((current) => ({
      ...current,
      activeClassId: classId,
    }))
    clearSelection()
  }

  const handleApplyPack = (nextPack: PackDefinition) => {
    setCustomPack(nextPack)
    markPackApplied(nextPack.subject)
    setSettings((current) => ({
      ...current,
      subject: nextPack.subject,
      questionCount: nextPack.defaultQuestionCount,
      secondsPerQuestion: nextPack.defaultSeconds,
    }))
    clearSelection()
    setShowQuestionBank(false)
  }

  const handleRestoreOfficialPack = () => {
    clearAppliedPack()
    setCustomPack(null)
    const officialPack = PACKS[settings.subject]
    setSettings((current) => ({
      ...current,
      questionCount: officialPack.defaultQuestionCount,
      secondsPerQuestion: officialPack.defaultSeconds,
    }))
  }

  if (phase === 'countdown' && selected.left && selected.right) {
    return (
      <CountdownScreen
        leftStudent={selected.left}
        rightStudent={selected.right}
        settings={matchSettings}
        onComplete={handleCountdownComplete}
      />
    )
  }

  if (phase === 'duel' && selected.left && selected.right) {
    return (
      <DuelArena
        leftStudent={selected.left}
        rightStudent={selected.right}
        settings={matchSettings}
        pack={activePack}
        onFinish={handleFinish}
        onExit={handleBackToSetup}
      />
    )
  }

  if (phase === 'result' && result && selected.left && selected.right) {
    return (
      <ResultScreen
        result={result}
        matchLabel={classroom.name}
        onNextMatch={handleNextMatch}
        onReplay={handleReplay}
        onBackToSetup={handleBackToSetup}
      />
    )
  }

  return (
    <>
      <SetupScreen
        classroomName={classroom.name}
        students={classroom.students}
        classrooms={classroomDirectory.classrooms}
        activeClassId={classroomDirectory.activeClassId}
        pack={activePack}
        customPack={customPack}
        selected={selected}
        settings={settings}
        onSettingsChange={setSettings}
        onPickName={handlePickName}
        onClearSelection={clearSelection}
        onRandomPair={handleRandomPair}
        onActivateClassroom={handleActivateClassroom}
        onOpenDiagnostics={() => setShowDiagnostics(true)}
        onOpenClassManager={() => setShowClassManager(true)}
        onOpenQuestionBank={() => setShowQuestionBank(true)}
        onOpenPracticeRecords={() => setShowPracticeRecords(true)}
        onOpenServerAdmin={() => setShowServerAdmin(true)}
        onRestoreOfficialPack={handleRestoreOfficialPack}
        onLogout={onLogout}
      />
      {selectionError && (
        <div className="selection-error selection-error--global" role="alert">
          {selectionError}
        </div>
      )}
      {showDiagnostics && <TouchTest onClose={() => setShowDiagnostics(false)} />}
      {showClassManager && (
        <ClassroomManager
          directory={classroomDirectory}
          onSave={handleSaveClassrooms}
          onClose={() => setShowClassManager(false)}
        />
      )}
      {showQuestionBank && (
        <QuestionBankManager
          initialSubject={settings.subject}
          onApplyPack={handleApplyPack}
          onClose={() => setShowQuestionBank(false)}
        />
      )}
      {showPracticeRecords && (
        <PracticeRecords
          classrooms={classroomDirectory.classrooms}
          initialClassId={classroomDirectory.activeClassId}
          onClose={() => setShowPracticeRecords(false)}
        />
      )}
      {showServerAdmin && (
        <ServerAdminPanel onClose={() => setShowServerAdmin(false)} />
      )}
    </>
  )
}

export default App

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import PracticeApp from './PracticeApp'
import TeacherAppRoot from './TeacherAppRoot'
import { hydratePracticeCacheFromServer } from './lib/serverSync'
import { startPracticeAttemptAutoSync } from './lib/practiceResults'
import 'katex/dist/katex.min.css'
import './styles.css'

async function start() {
  const isPracticeRoute = /^\/practice\/?$/i.test(window.location.pathname)
  if (isPracticeRoute) {
    await hydratePracticeCacheFromServer()
  }
  startPracticeAttemptAutoSync()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {isPracticeRoute ? <PracticeApp /> : <TeacherAppRoot />}
    </StrictMode>,
  )
}

void start()

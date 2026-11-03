export interface SpeakOptions {
  text: string
  lang: 'en-US' | 'en-GB'
  rate?: number
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

function findEnglishVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  const exact = voices.filter((voice) => voice.lang.toLowerCase().startsWith(lang.toLowerCase()))
  const local = exact.find((voice) => voice.localService)
  return local ?? exact[0] ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('en'))
}

export function speakEnglish({ text, lang, rate = 0.82 }: SpeakOptions): Promise<void> {
  if (!speechSupported()) {
    return Promise.reject(new Error('当前浏览器不支持语音合成'))
  }

  window.speechSynthesis.cancel()

  return new Promise((resolve, reject) => {
    let settled = false
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = findEnglishVoice(lang)
    const watchdog = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('语音播放超时'))
      window.speechSynthesis.cancel()
    }, Math.max(5000, text.length * 500))

    utterance.lang = lang
    utterance.rate = rate
    utterance.pitch = 1
    utterance.volume = 1
    if (voice) utterance.voice = voice

    utterance.onend = () => {
      if (settled) return
      settled = true
      window.clearTimeout(watchdog)
      resolve()
    }

    utterance.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(watchdog)
      reject(new Error('语音播放失败'))
    }

    window.speechSynthesis.speak(utterance)
  })
}

export async function primeSpeechEngine(): Promise<void> {
  if (!speechSupported()) return
  window.speechSynthesis.getVoices()
  const utterance = new SpeechSynthesisUtterance('')
  utterance.volume = 0
  utterance.lang = 'en-US'
  window.speechSynthesis.speak(utterance)
}

import katex from 'katex'
import { memo, useMemo } from 'react'

interface MathTextProps {
  text: string
  className?: string
}

export const MathText = memo(function MathText({ text, className }: MathTextProps) {
  const renderedParts = useMemo(
    () =>
      text.split(/(\$[^$]+\$)/g).filter(Boolean).map((part) => {
        if (!part.startsWith('$') || !part.endsWith('$')) {
          return { key: part, kind: 'text' as const, value: part }
        }

        return {
          key: part,
          kind: 'math' as const,
          value: katex.renderToString(String.raw`\displaystyle ${part.slice(1, -1)}`, {
            throwOnError: false,
            strict: 'ignore',
            trust: false,
            output: 'htmlAndMathml',
          }),
        }
      }),
    [text],
  )

  return (
    <span className={className}>
      {renderedParts.map((part, index) => {
        if (part.kind === 'text') {
          return <span key={`${part.key}-${index}`}>{part.value}</span>
        }

        return (
          <span
            key={`${part.key}-${index}`}
            className="math-fragment"
            dangerouslySetInnerHTML={{ __html: part.value }}
          />
        )
      })}
    </span>
  )
})

import { Check, Copy, WrapText } from 'lucide-react'
import { Highlight, type PrismTheme } from 'prism-react-renderer'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Token colours come from CSS variables, so light/dark follow the app theme. */
const theme: PrismTheme = {
  plain: { color: 'var(--code-fg)', backgroundColor: 'var(--code-bg)' },
  styles: [
    { types: ['comment'], style: { color: 'var(--code-comment)', fontStyle: 'italic' } },
    { types: ['keyword', 'boolean'], style: { color: 'var(--code-keyword)', fontWeight: '500' } },
    { types: ['string', 'char'], style: { color: 'var(--code-string)' } },
    { types: ['number'], style: { color: 'var(--code-number)' } },
    { types: ['function'], style: { color: 'var(--code-function)' } },
    { types: ['operator', 'punctuation'], style: { color: 'var(--code-operator)' } },
    { types: ['variable'], style: { color: 'var(--code-number)' } },
  ],
}

interface SqlCodeProps {
  code: string
  className?: string
  /** Show line numbers (default true for long code). */
  lineNumbers?: boolean
  maxHeight?: string
}

export function SqlCode({ code, className, lineNumbers, maxHeight }: SqlCodeProps) {
  const [copied, setCopied] = useState(false)
  // wrapped by default: nobody scrolls sideways on a projector
  const [wrap, setWrap] = useState(true)
  const showNumbers = lineNumbers ?? code.split('\n').length > 6

  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={cn('group/code relative w-full min-w-0 overflow-hidden rounded-lg ring-1 ring-foreground/10', className)}>
      <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover/code:opacity-100 focus-within:opacity-100">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setWrap((w) => !w)}
          aria-label={wrap ? 'Do not wrap long lines' : 'Wrap long lines'}
          aria-pressed={wrap}
          title={wrap ? 'Long lines wrap (click to scroll instead)' : 'Long lines scroll (click to wrap)'}
          className="bg-background/70 backdrop-blur"
        >
          <WrapText />
        </Button>
        <Button type="button" size="icon-xs" variant="ghost" onClick={copy} aria-label="Copy SQL" className="bg-background/70 backdrop-blur">
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <Highlight code={code} language="sql" theme={theme}>
        {({ className: hlClass, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={cn(hlClass, 'overflow-auto py-3 font-mono text-[12.5px] leading-[1.6]')}
            style={{ ...style, maxHeight }}
          >
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line })
              return (
                <div key={i} {...lineProps} className={cn(lineProps.className, 'flex min-w-full px-3', !wrap && 'w-max')}>
                  {showNumbers ? (
                    <span className="mr-4 inline-block w-6 shrink-0 text-right text-[11px] text-(--code-comment) select-none">
                      {i + 1}
                    </span>
                  ) : null}
                  <span className={wrap ? 'min-w-0 break-words whitespace-pre-wrap' : 'whitespace-pre'}>
                    {line.map((token, k) => (
                      <span key={k} {...getTokenProps({ token })} />
                    ))}
                  </span>
                </div>
              )
            })}
          </pre>
        )}
      </Highlight>
    </div>
  )
}

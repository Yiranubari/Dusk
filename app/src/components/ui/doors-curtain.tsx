import { useState, useEffect, useImperativeHandle, forwardRef } from 'react'

export type DoorsCurtainHandle = {
  close: (onClosed?: () => void) => Promise<void>
  open: () => Promise<void>
  isTransitioning: boolean
}

type DoorsCurtainProps = {
  duration?: number
  delay?: number
}

export const DoorsCurtain = forwardRef<DoorsCurtainHandle, DoorsCurtainProps>(
  ({ duration = 3500, delay = 600 }, ref) => {
    const [state, setState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed')

    useEffect(() => {
      const delayTimer = setTimeout(() => {
        setState('opening')
      }, delay)

      const finishTimer = setTimeout(() => {
        setState('open')
      }, delay + duration)

      return () => {
        clearTimeout(delayTimer)
        clearTimeout(finishTimer)
      }
    }, [delay, duration])

    const close = (onClosed?: () => void) => {
      return new Promise<void>((resolve) => {
        setState('closing')
        setTimeout(() => {
          setState('closed')
          if (onClosed) onClosed()
          resolve()
        }, 1200)
      })
    }

    const open = () => {
      return new Promise<void>((resolve) => {
        setState('opening')
        setTimeout(() => {
          setState('open')
          resolve()
        }, duration)
      })
    }

    useImperativeHandle(ref, () => ({
      close,
      open,
      isTransitioning: state !== 'open',
    }))

    if (state === 'open') return null

    const openDuration = `${duration}ms`
    const closeDuration = '1200ms'

    return (
      <div className="fixed inset-0 z-[60] flex overflow-hidden pointer-events-none">
        <div
          className="h-full w-1/2 bg-black border-r border-zinc-700"
          style={{
            animation:
              state === 'opening'
                ? `door-left-open ${openDuration} cubic-bezier(0.4, 0, 0.2, 1) forwards`
                : state === 'closing'
                  ? `door-left-close ${closeDuration} cubic-bezier(0.4, 0, 0.2, 1) forwards`
                  : undefined,
            transform: state === 'closed' ? 'translateX(0%)' : undefined,
          }}
        />
        <div
          className="h-full w-1/2 bg-black border-l border-zinc-700"
          style={{
            animation:
              state === 'opening'
                ? `door-right-open ${openDuration} cubic-bezier(0.4, 0, 0.2, 1) forwards`
                : state === 'closing'
                  ? `door-right-close ${closeDuration} cubic-bezier(0.4, 0, 0.2, 1) forwards`
                  : undefined,
            transform: state === 'closed' ? 'translateX(0%)' : undefined,
          }}
        />
      </div>
    )
  },
)
DoorsCurtain.displayName = 'DoorsCurtain'

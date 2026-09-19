import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export const BackgroundRippleEffect = ({
  rows = 20,
  cols = 36,
  cellSize = 56,
}: {
  rows?: number
  cols?: number
  cellSize?: number
}) => {
  const [clickedCell, setClickedCell] = useState<{
    row: number
    col: number
  } | null>(null)
  const [rippleKey, setRippleKey] = useState(0)
  const ref = useRef<HTMLDivElement | null>(null)

  return (
    <div
      ref={ref}
      className={cn(
        'absolute inset-0 h-full w-full pointer-events-auto flex items-center justify-center overflow-hidden',
        '[mask-image:linear-gradient(to_bottom,black_40%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_40%,transparent_100%)]',
        '[--cell-border-color:rgba(255,255,255,0.08)] [--cell-fill-color:transparent] [--cell-shadow-color:rgba(255,255,255,0.1)]',
      )}
    >
      <div className="relative h-full w-full overflow-hidden flex items-center justify-center">
        <DivGrid
          key={`base-${rippleKey}`}
          rows={rows}
          cols={cols}
          cellSize={cellSize}
          borderColor="var(--cell-border-color)"
          fillColor="var(--cell-fill-color)"
          clickedCell={clickedCell}
          onCellClick={(row, col) => {
            setClickedCell({ row, col })
            setRippleKey((k) => k + 1)
          }}
          interactive
        />
      </div>
    </div>
  )
}

type DivGridProps = {
  className?: string
  rows: number
  cols: number
  cellSize: number
  borderColor: string
  fillColor: string
  clickedCell: { row: number; col: number } | null
  onCellClick?: (row: number, col: number) => void
  interactive?: boolean
}

type CellStyle = CSSProperties & {
  ['--delay']?: string
  ['--duration']?: string
}

const DivGrid = ({
  className,
  rows = 20,
  cols = 36,
  cellSize = 56,
  borderColor = 'rgba(255,255,255,0.08)',
  fillColor = 'transparent',
  clickedCell = null,
  onCellClick = () => {},
  interactive = true,
}: DivGridProps) => {
  const cells = useMemo(
    () => Array.from({ length: rows * cols }, (_, idx) => idx),
    [rows, cols],
  )

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
    width: cols * cellSize,
    height: rows * cellSize,
    marginInline: 'auto',
  }

  return (
    <div className={cn('relative z-[1]', className)} style={gridStyle}>
      {cells.map((idx) => {
        const rowIdx = Math.floor(idx / cols)
        const colIdx = idx % cols
        const distance = clickedCell
          ? Math.hypot(clickedCell.row - rowIdx, clickedCell.col - colIdx)
          : 0
        const delay = clickedCell ? Math.max(0, distance * 55) : 0
        const duration = 200 + distance * 80

        const style: CellStyle = clickedCell
          ? {
              '--delay': `${delay}ms`,
              '--duration': `${duration}ms`,
            }
          : {}

        return (
          <div
            key={idx}
            className={cn(
              'cell relative border-[0.5px] cursor-pointer transition-colors duration-150 hover:bg-white/[0.06]',
              clickedCell && 'animate-cell-ripple',
              !interactive && 'pointer-events-none',
            )}
            style={{
              backgroundColor: fillColor,
              borderColor: borderColor,
              ...style,
            }}
            onClick={
              interactive ? () => onCellClick?.(rowIdx, colIdx) : undefined
            }
          />
        )
      })}
    </div>
  )
}

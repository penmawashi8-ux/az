'use client'

import { useReducer, useEffect, useState } from 'react'
import {
  COLORS,
  COLOR_LABEL,
  getWallColor,
  getWallCol,
} from '@/lib/gameTypes'
import type { Color, GameState, FinalBreakdown } from '@/lib/gameTypes'
import { createInitialState, gameReducer, canPlaceOnRow } from '@/lib/gameLogic'

// ──────────────────────────────────────────────
//  Static Tailwind class maps
//  (All strings must be complete so Tailwind includes them)
// ──────────────────────────────────────────────
const CS = {
  blue: {
    tile:    'bg-sky-300 border-sky-400',
    faint:   'bg-sky-100 border-sky-200',
    ring:    'ring-sky-500',
    text:    'text-sky-700',
    badge:   'bg-sky-200 text-sky-800',
    hover:   'hover:bg-sky-200',
    rowHl:   'bg-sky-50 border-sky-300 ring-1 ring-sky-400',
    rowBase: 'border-sky-200',
  },
  yellow: {
    tile:    'bg-amber-200 border-amber-300',
    faint:   'bg-amber-50 border-amber-200',
    ring:    'ring-amber-400',
    text:    'text-amber-700',
    badge:   'bg-amber-100 text-amber-800',
    hover:   'hover:bg-amber-100',
    rowHl:   'bg-amber-50 border-amber-300 ring-1 ring-amber-400',
    rowBase: 'border-amber-200',
  },
  red: {
    tile:    'bg-rose-300 border-rose-400',
    faint:   'bg-rose-100 border-rose-200',
    ring:    'ring-rose-500',
    text:    'text-rose-700',
    badge:   'bg-rose-200 text-rose-800',
    hover:   'hover:bg-rose-200',
    rowHl:   'bg-rose-50 border-rose-300 ring-1 ring-rose-400',
    rowBase: 'border-rose-200',
  },
  purple: {
    tile:    'bg-violet-300 border-violet-400',
    faint:   'bg-violet-100 border-violet-200',
    ring:    'ring-violet-500',
    text:    'text-violet-700',
    badge:   'bg-violet-200 text-violet-800',
    hover:   'hover:bg-violet-200',
    rowHl:   'bg-violet-50 border-violet-300 ring-1 ring-violet-400',
    rowBase: 'border-violet-200',
  },
  green: {
    tile:    'bg-emerald-300 border-emerald-400',
    faint:   'bg-emerald-100 border-emerald-200',
    ring:    'ring-emerald-500',
    text:    'text-emerald-700',
    badge:   'bg-emerald-200 text-emerald-800',
    hover:   'hover:bg-emerald-200',
    rowHl:   'bg-emerald-50 border-emerald-300 ring-1 ring-emerald-400',
    rowBase: 'border-emerald-200',
  },
} as const satisfies Record<Color, Record<string, string>>

// ──────────────────────────────────────────────
//  Sub-components
// ──────────────────────────────────────────────

/** A single coloured tile (filled or faint/ghost) */
function Tile({
  color,
  faint = false,
  selected = false,
  popping = false,
  size = 'md',
}: {
  color: Color
  faint?: boolean
  selected?: boolean
  popping?: boolean
  size?: 'sm' | 'md'
}) {
  const sz   = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9 sm:w-10 sm:h-10'
  const face = faint ? CS[color].faint : CS[color].tile
  const ring = selected ? `ring-2 ${CS[color].ring} ring-offset-1` : ''
  const pop  = popping  ? 'animate-tile-pop' : ''

  return (
    <div
      className={`
        ${sz} rounded-xl border-2 shadow-sm
        ${face} ${ring} ${pop}
        transition-all duration-200 flex items-center justify-center
      `}
    />
  )
}

/** An empty placeholder slot */
function EmptySlot({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9 sm:w-10 sm:h-10'
  return (
    <div className={`${sz} rounded-xl border-2 border-dashed border-slate-300 bg-white/60`} />
  )
}

// ── Market ──────────────────────────────────────
function MarketArea({
  state,
  onSelect,
}: {
  state: GameState
  onSelect: (c: Color) => void
}) {
  const { market, selectedColor, selectedCount, phase } = state

  // Count tiles per colour in the remaining market
  const counts: Partial<Record<Color, number>> = {}
  for (const c of market) counts[c] = (counts[c] ?? 0) + 1

  const canAct = phase === 'select' && !state.gameOver

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 shadow-md border border-white/60 h-full">
      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
        🏪 マーケット
      </h2>

      {/* Banner when in "place" phase */}
      {phase === 'place' && selectedColor && (
        <div
          className={`
            mb-3 px-3 py-2 rounded-xl text-sm font-semibold text-center
            ${CS[selectedColor].badge}
          `}
        >
          {COLOR_LABEL[selectedColor]}タイルを {selectedCount}枚取得！<br />
          <span className="text-xs font-normal opacity-80">手元ボードの行をクリックして配置</span>
        </div>
      )}

      {market.length === 0 && phase === 'select' ? (
        <div className="text-center py-10 text-slate-400 text-sm">
          <div className="text-4xl mb-2">🎲</div>
          <p>次のラウンドを準備中…</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {COLORS.map(color => {
            const cnt = counts[color] ?? 0
            if (cnt === 0) return null
            const isSelected = selectedColor === color

            return (
              <button
                key={color}
                onClick={() => canAct && onSelect(color)}
                disabled={!canAct}
                className={`
                  flex items-center gap-3 w-full px-3 py-2.5 rounded-xl border-2
                  transition-all duration-200 text-left
                  ${isSelected
                    ? `border-slate-600 bg-slate-50 shadow-md scale-[1.02] ring-2 ${CS[color].ring}`
                    : canAct
                      ? `border-slate-200 bg-white hover:scale-[1.02] hover:shadow-sm hover:border-slate-300 cursor-pointer`
                      : 'border-slate-200 bg-white opacity-50 cursor-not-allowed'
                  }
                `}
              >
                <div className="flex gap-1 flex-wrap">
                  {Array.from({ length: cnt }, (_, i) => (
                    <Tile key={i} color={color} selected={isSelected} />
                  ))}
                </div>
                <span className={`ml-auto text-sm font-bold ${CS[color].text}`}>
                  {COLOR_LABEL[color]} ×{cnt}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Hand Board ──────────────────────────────────
function HandBoard({
  state,
  onPlace,
}: {
  state: GameState
  onPlace: (rowIndex: number) => void
}) {
  const { handRows, wall, phase, selectedColor, gameOver } = state

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 shadow-md border border-white/60 h-full">
      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
        🧩 手元ボード
      </h2>

      <div className="flex flex-col gap-2">
        {handRows.map((row, rowIndex) => {
          const capacity = rowIndex + 1
          const placeable = canPlaceOnRow(state, rowIndex)
          const isDisabled = !placeable && phase === 'place'

          // Wall slot already filled for this colour in this row
          const wallSlotFilled =
            selectedColor !== null &&
            wall[rowIndex][getWallCol(rowIndex, selectedColor)]

          // Background/border based on state
          let rowClass = 'border-slate-200 bg-white/60'
          if (phase === 'place' && selectedColor) {
            if (placeable) {
              rowClass = CS[selectedColor].rowHl
            } else if (
              row.color !== null &&
              row.color !== selectedColor
            ) {
              rowClass = 'border-red-200 bg-red-50/60 opacity-60'
            } else if (wallSlotFilled) {
              rowClass = 'border-slate-300 bg-slate-100/60 opacity-50'
            } else if (row.count >= capacity) {
              rowClass = 'border-slate-300 bg-slate-100/60 opacity-50'
            }
          }

          return (
            <button
              key={rowIndex}
              onClick={() => !gameOver && placeable && onPlace(rowIndex)}
              disabled={!placeable || gameOver}
              className={`
                flex items-center gap-1.5 w-full px-3 py-2 rounded-xl border-2
                transition-all duration-200
                ${rowClass}
                ${placeable && !gameOver ? 'cursor-pointer hover:scale-[1.01]' : 'cursor-default'}
              `}
            >
              {/* Row number badge */}
              <span className="text-xs text-slate-400 font-mono w-4 shrink-0">
                {rowIndex + 1}
              </span>

              {/* Tiles (right-aligned: empty slots → filled tiles) */}
              <div className="flex gap-1 ml-auto">
                {/* Empty slots */}
                {Array.from({ length: capacity - row.count }, (_, i) => (
                  <EmptySlot key={`e-${i}`} />
                ))}
                {/* Filled tiles */}
                {row.color &&
                  Array.from({ length: row.count }, (_, i) => (
                    <Tile key={`f-${i}`} color={row.color!} />
                  ))}
              </div>

              {/* Capacity label */}
              <span className="text-xs text-slate-300 font-mono w-8 text-right shrink-0">
                {row.count}/{capacity}
              </span>
            </button>
          )
        })}
      </div>

      {phase === 'select' && (
        <p className="mt-4 text-xs text-center text-slate-400">
          ← マーケットから色を選んでください
        </p>
      )}
    </div>
  )
}

// ── Wall Grid ────────────────────────────────────
function WallGrid({
  wall,
  animatingCell,
}: {
  wall: GameState['wall']
  animatingCell: GameState['animatingCell']
}) {
  // Track which cell just got the pop animation (cleared after 500ms)
  const [popCell, setPopCell] = useState<{ row: number; col: number } | null>(null)

  useEffect(() => {
    if (!animatingCell) return
    setPopCell(animatingCell)
    const t = setTimeout(() => setPopCell(null), 500)
    return () => clearTimeout(t)
  }, [animatingCell])

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 shadow-md border border-white/60 h-full">
      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
        🏛️ 壁グリッド
      </h2>

      <div className="flex flex-col gap-1.5 items-center">
        {Array.from({ length: 5 }, (_, row) => (
          <div key={row} className="flex gap-1.5">
            {Array.from({ length: 5 }, (_, col) => {
              const color = getWallColor(row, col)
              const filled = wall[row][col]
              const isPopping =
                popCell?.row === row && popCell?.col === col

              return (
                <div
                  key={col}
                  className={`
                    w-9 h-9 sm:w-10 sm:h-10 rounded-xl border-2
                    flex items-center justify-center
                    transition-all duration-300
                    ${filled
                      ? CS[color].tile + ' shadow-md'
                      : CS[color].faint
                    }
                    ${isPopping ? 'animate-tile-pop' : ''}
                  `}
                >
                  {!filled && (
                    <span
                      className={`text-xs font-bold opacity-40 ${CS[color].text}`}
                      aria-hidden
                    >
                      {COLOR_LABEL[color]}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Completion progress */}
      <div className="mt-3 flex flex-col gap-1">
        {Array.from({ length: 5 }, (_, r) => {
          const filled = wall[r].filter(Boolean).length
          return (
            <div key={r} className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400 w-3">{r + 1}</span>
              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-slate-400 rounded-full transition-all duration-500"
                  style={{ width: `${(filled / 5) * 100}%` }}
                />
              </div>
              <span className="text-xs text-slate-400 w-6 text-right">{filled}/5</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Score Panel ──────────────────────────────────
function ScorePanel({
  score,
  round,
  turn,
  onReset,
}: {
  score: number
  round: number
  turn: number
  onReset: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white/70 backdrop-blur-sm rounded-2xl shadow-md border border-white/60">
      {/* Title */}
      <div className="flex items-center gap-2">
        <span className="text-xl font-black text-slate-700 tracking-tight">
          タイルヤード
        </span>
        <span className="text-xs text-slate-400 font-medium hidden sm:block">
          Tile Yard
        </span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm">
        <Stat label="スコア" value={score} accent />
        <Stat label="ラウンド" value={round} />
        <Stat label="ターン" value={turn} />
      </div>

      {/* Reset */}
      <button
        onClick={onReset}
        className="text-sm text-slate-500 hover:text-slate-700 border border-slate-300
                   hover:border-slate-400 rounded-xl px-3 py-1.5 transition-all duration-150
                   hover:bg-slate-50 font-medium"
      >
        🔄 最初から
      </button>
    </div>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center leading-none">
      <span className="text-xs text-slate-400 font-medium">{label}</span>
      <span
        className={`text-lg font-black tabular-nums ${
          accent ? 'text-indigo-600' : 'text-slate-700'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

// ── Game Over Modal ──────────────────────────────
function GameOverModal({
  breakdown,
  score,
  turn,
  onReset,
}: {
  breakdown: FinalBreakdown
  score: number
  turn: number
  onReset: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="animate-fade-in w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 border border-white/80">
        {/* Header */}
        <div className="text-center mb-5">
          <div className="text-5xl mb-2">🏆</div>
          <h2 className="text-2xl font-black text-slate-800">ゲーム終了！</h2>
          <p className="text-sm text-slate-500 mt-1">{turn - 1} ターンで完了</p>
        </div>

        {/* Final score */}
        <div className="text-center mb-5">
          <div className="text-6xl font-black text-indigo-600 tabular-nums animate-score-pop">
            {score}
          </div>
          <div className="text-sm text-slate-400 font-medium mt-1">合計得点</div>
        </div>

        {/* Breakdown table */}
        <div className="bg-slate-50 rounded-2xl p-4 mb-5 text-sm space-y-2">
          <ScoreRow
            label="タイル配置得点"
            value={breakdown.baseScore}
            icon="🎯"
          />
          <ScoreRow
            label={`横一列ボーナス ×${breakdown.completedRows}`}
            value={breakdown.rowBonus}
            icon="➡️"
            disabled={breakdown.completedRows === 0}
          />
          <ScoreRow
            label={`縦一列ボーナス ×${breakdown.completedCols}`}
            value={breakdown.colBonus}
            icon="⬇️"
            disabled={breakdown.completedCols === 0}
          />
          <ScoreRow
            label={`同色5枚ボーナス ×${breakdown.completedColors}`}
            value={breakdown.colorBonus}
            icon="🎨"
            disabled={breakdown.completedColors === 0}
          />
          <div className="border-t border-slate-200 pt-2 flex justify-between font-black text-slate-800">
            <span>合計</span>
            <span className="text-indigo-600 tabular-nums">{score}</span>
          </div>
        </div>

        {/* Rating */}
        <div className="text-center mb-5 text-slate-600 text-sm font-medium">
          {score >= 50
            ? '🌟 素晴らしい！マスターレベル'
            : score >= 30
              ? '🎉 よくできました！'
              : score >= 15
                ? '👍 なかなか上手い！'
                : '💪 次は高得点を目指そう！'}
        </div>

        <button
          onClick={onReset}
          className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800
                     text-white font-bold text-sm transition-colors duration-150 shadow-lg
                     shadow-indigo-200"
        >
          🔄 もう一度プレイ
        </button>
      </div>
    </div>
  )
}

function ScoreRow({
  label,
  value,
  icon,
  disabled = false,
}: {
  label: string
  value: number
  icon: string
  disabled?: boolean
}) {
  return (
    <div className={`flex justify-between items-center ${disabled ? 'opacity-40' : ''}`}>
      <span className="flex items-center gap-1.5 text-slate-600">
        <span>{icon}</span>
        {label}
      </span>
      <span className="font-bold text-slate-800 tabular-nums">
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  )
}

// ── Instructions overlay ─────────────────────────
function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="animate-fade-in w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6">
        <h2 className="text-lg font-black text-slate-800 mb-4">🎮 遊び方</h2>
        <ol className="text-sm text-slate-600 space-y-3 list-none">
          {[
            ['🏪', 'マーケットから色を1つ選ぶ（その色をすべて取得）'],
            ['🧩', '手元ボードの好きな行に置く（同色のみ追加可・各行上限あり）'],
            ['🏛️', '行が満杯になると壁へ自動移動→得点！'],
            ['🎯', '壁の隣接タイル1枚につき+1点（孤立は+1点）'],
            ['🏆', '壁の横一列が完成したらゲーム終了'],
          ].map(([icon, text], i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0">{icon}</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-slate-400 bg-slate-50 rounded-xl p-3">
          🎁 ボーナス：横一列完成+2点 / 縦一列完成+7点 / 同色5枚完成+10点
        </p>
        <button
          onClick={onClose}
          className="mt-5 w-full py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700
                     text-white font-bold text-sm transition-colors"
        >
          はじめる！
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
//  Main game component
// ──────────────────────────────────────────────
export default function TileYardGame() {
  const [state, dispatch] = useReducer(gameReducer, undefined, createInitialState)
  const [showHelp, setShowHelp] = useState(true)

  const handleReset = () => {
    dispatch({ type: 'RESET' })
    setShowHelp(false)
  }

  return (
    <div className="min-h-screen p-3 sm:p-4 lg:p-6 flex flex-col gap-3 max-w-6xl mx-auto">
      {/* ── Top bar ── */}
      <ScorePanel
        score={state.score}
        round={state.round}
        turn={state.turn}
        onReset={handleReset}
      />

      {/* ── Phase hint ── */}
      <div
        className={`
          text-center text-sm font-semibold py-2 px-4 rounded-xl transition-all duration-300
          ${state.phase === 'select'
            ? 'bg-indigo-100 text-indigo-700'
            : state.selectedColor
              ? CS[state.selectedColor].badge + ' text-sm'
              : 'bg-slate-100 text-slate-600'
          }
        `}
      >
        {state.gameOver
          ? '🎊 ゲーム終了です！結果をご確認ください'
          : state.phase === 'select'
            ? '① マーケットから色を選んでください'
            : state.selectedColor
              ? `② ${COLOR_LABEL[state.selectedColor]}タイル ${state.selectedCount}枚を置く行を選んでください`
              : ''}
      </div>

      {/* ── Three-column layout ── */}
      <div className="flex flex-col lg:flex-row gap-3 flex-1">
        {/* Left: Market */}
        <div className="lg:w-56 shrink-0">
          <MarketArea
            state={state}
            onSelect={color => dispatch({ type: 'SELECT_COLOR', color })}
          />
        </div>

        {/* Center: Hand Board */}
        <div className="flex-1">
          <HandBoard
            state={state}
            onPlace={rowIndex => dispatch({ type: 'PLACE_ON_ROW', rowIndex })}
          />
        </div>

        {/* Right: Wall Grid */}
        <div className="lg:w-64 shrink-0">
          <WallGrid
            wall={state.wall}
            animatingCell={state.animatingCell}
          />
        </div>
      </div>

      {/* ── Help button (bottom) ── */}
      <div className="text-center">
        <button
          onClick={() => setShowHelp(true)}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors underline underline-offset-2"
        >
          遊び方を見る
        </button>
      </div>

      {/* ── Overlays ── */}
      {showHelp && !state.gameOver && (
        <HowToPlay onClose={() => setShowHelp(false)} />
      )}

      {state.gameOver && state.finalBreakdown && (
        <GameOverModal
          breakdown={state.finalBreakdown}
          score={state.score}
          turn={state.turn}
          onReset={handleReset}
        />
      )}
    </div>
  )
}

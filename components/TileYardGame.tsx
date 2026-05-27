'use client'

import { useReducer, useEffect, useState } from 'react'
import { COLORS, COLOR_LABEL, getWallColor, getWallCol } from '@/lib/gameTypes'
import type { Color, GameState, FinalBreakdown } from '@/lib/gameTypes'
import {
  createInitialState,
  gameReducer,
  canPlaceOnRow,
  hasAnyValidRow,
} from '@/lib/gameLogic'

// ──────────────────────────────────────────────
//  Tailwind class maps (must be complete strings)
// ──────────────────────────────────────────────
const CS = {
  blue: {
    tile:  'bg-sky-300 border-sky-400',
    faint: 'bg-sky-100 border-sky-200',
    ring:  'ring-sky-500',
    text:  'text-sky-700',
    badge: 'bg-sky-100 text-sky-800',
    rowHl: 'bg-sky-50 border-sky-400 ring-1 ring-sky-300',
  },
  yellow: {
    tile:  'bg-amber-200 border-amber-300',
    faint: 'bg-amber-50 border-amber-200',
    ring:  'ring-amber-400',
    text:  'text-amber-700',
    badge: 'bg-amber-100 text-amber-700',
    rowHl: 'bg-amber-50 border-amber-400 ring-1 ring-amber-300',
  },
  red: {
    tile:  'bg-rose-300 border-rose-400',
    faint: 'bg-rose-100 border-rose-200',
    ring:  'ring-rose-500',
    text:  'text-rose-700',
    badge: 'bg-rose-100 text-rose-800',
    rowHl: 'bg-rose-50 border-rose-400 ring-1 ring-rose-300',
  },
  purple: {
    tile:  'bg-violet-300 border-violet-400',
    faint: 'bg-violet-100 border-violet-200',
    ring:  'ring-violet-500',
    text:  'text-violet-700',
    badge: 'bg-violet-100 text-violet-800',
    rowHl: 'bg-violet-50 border-violet-400 ring-1 ring-violet-300',
  },
  green: {
    tile:  'bg-emerald-300 border-emerald-400',
    faint: 'bg-emerald-100 border-emerald-200',
    ring:  'ring-emerald-500',
    text:  'text-emerald-700',
    badge: 'bg-emerald-100 text-emerald-800',
    rowHl: 'bg-emerald-50 border-emerald-400 ring-1 ring-emerald-300',
  },
} as const satisfies Record<Color, Record<string, string>>

// ──────────────────────────────────────────────
//  Primitives
// ──────────────────────────────────────────────
function Tile({
  color,
  faint = false,
  selected = false,
  popping = false,
}: {
  color: Color
  faint?: boolean
  selected?: boolean
  popping?: boolean
}) {
  return (
    <div
      className={`
        w-7 h-7 rounded-lg border-2 shrink-0
        ${faint ? CS[color].faint : CS[color].tile}
        ${selected ? `ring-2 ring-offset-1 ${CS[color].ring}` : ''}
        ${popping ? 'animate-tile-pop' : ''}
        transition-all duration-200
      `}
    />
  )
}

function EmptySlot() {
  return (
    <div className="w-7 h-7 rounded-lg border-2 border-dashed border-slate-300 bg-white/50 shrink-0" />
  )
}

// ──────────────────────────────────────────────
//  Header
// ──────────────────────────────────────────────
function Header({
  score, round, turn, onReset, onHelp,
}: {
  score: number; round: number; turn: number
  onReset: () => void; onHelp: () => void
}) {
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-white/80 border-b border-slate-200">
      <span className="font-black text-slate-800 text-base tracking-tight">タイルヤード</span>
      <div className="flex gap-3 ml-auto">
        {[['スコア', score, 'text-indigo-600'], ['R', round, 'text-slate-700'], ['T', turn, 'text-slate-700']].map(
          ([label, val, cls]) => (
            <div key={String(label)} className="text-center">
              <div className="text-[10px] text-slate-400 leading-none">{label}</div>
              <div className={`text-base font-black tabular-nums leading-tight ${cls}`}>{val}</div>
            </div>
          )
        )}
      </div>
      <div className="flex gap-1 ml-2">
        <button
          onClick={onHelp}
          className="text-xs text-slate-500 border border-slate-300 rounded-lg w-7 h-7 flex items-center justify-center hover:bg-slate-50 active:bg-slate-100"
        >
          ?
        </button>
        <button
          onClick={onReset}
          className="text-xs text-slate-600 border border-slate-300 rounded-lg px-2 h-7 hover:bg-slate-50 active:bg-slate-100 font-medium"
        >
          やり直す
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
//  Market
// ──────────────────────────────────────────────
function MarketArea({
  state,
  onSelect,
}: {
  state: GameState
  onSelect: (c: Color) => void
}) {
  const { market, selectedColor, phase, gameOver } = state
  const canAct = phase === 'select' && !gameOver

  const counts: Partial<Record<Color, number>> = {}
  for (const c of market) counts[c] = (counts[c] ?? 0) + 1

  return (
    <div className="shrink-0 px-3 py-2 bg-white/60 border-b border-slate-200">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
        マーケット
      </div>
      {market.length === 0 && phase === 'select' ? (
        <div className="text-xs text-slate-400 py-1">補充中...</div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {COLORS.map(color => {
            const cnt = counts[color] ?? 0
            if (cnt === 0) return null
            const isSelected = selectedColor === color
            // Dim colors that have nowhere to be placed
            const noRoom = canAct && !hasAnyValidRow(state, color)

            return (
              <button
                key={color}
                onClick={() => canAct && !noRoom && onSelect(color)}
                disabled={!canAct || noRoom}
                title={noRoom ? '置ける行がありません' : undefined}
                className={`
                  flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border-2
                  transition-all duration-150 active:scale-95
                  ${isSelected
                    ? `border-slate-600 bg-white shadow-sm ring-2 ${CS[color].ring}`
                    : noRoom
                      ? 'border-slate-200 bg-white/50 opacity-40 cursor-not-allowed'
                      : canAct
                        ? 'border-slate-200 bg-white hover:border-slate-400 cursor-pointer'
                        : 'border-slate-200 bg-white/70 opacity-50 cursor-not-allowed'
                  }
                `}
              >
                <Tile color={color} selected={isSelected} />
                <span className={`text-xs font-bold ${CS[color].text}`}>
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

// ──────────────────────────────────────────────
//  Phase bar  (hint + discard button)
// ──────────────────────────────────────────────
function PhaseBar({
  state,
  onDiscard,
}: {
  state: GameState
  onDiscard: () => void
}) {
  const { phase, selectedColor, selectedCount, gameOver } = state

  if (gameOver) {
    return (
      <div className="shrink-0 px-3 py-1.5 text-xs font-medium text-center bg-slate-100 text-slate-600">
        ゲーム終了です
      </div>
    )
  }

  if (phase === 'place' && selectedColor) {
    const stuck = !hasAnyValidRow(state, selectedColor)
    return (
      <div className={`shrink-0 flex items-center gap-2 px-3 py-1.5 ${CS[selectedColor].badge}`}>
        <span className="text-xs font-medium flex-1">
          {COLOR_LABEL[selectedColor]}を {selectedCount}枚取得
          {stuck ? '　→　置ける行がありません' : '　→　行を選んで配置'}
        </span>
        <button
          onClick={onDiscard}
          className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg bg-white/60 border border-current opacity-70 hover:opacity-100 active:scale-95 transition-all"
        >
          捨てる
        </button>
      </div>
    )
  }

  return (
    <div className="shrink-0 px-3 py-1.5 text-xs font-medium text-center bg-indigo-50 text-indigo-700">
      マーケットから色を選んでください
    </div>
  )
}

// ──────────────────────────────────────────────
//  Unified game grid  (hand board rows + wall rows aligned)
// ──────────────────────────────────────────────
function GameGrid({
  state,
  popCell,
  onPlace,
}: {
  state: GameState
  popCell: { row: number; col: number } | null
  onPlace: (i: number) => void
}) {
  const { handRows, wall, phase, selectedColor, gameOver } = state

  return (
    <div className="flex flex-col gap-2 w-full">
      {handRows.map((row, rowIndex) => {
        const capacity = rowIndex + 1
        const placeable = canPlaceOnRow(state, rowIndex)

        // Hand board row style
        let rowStyle = 'border-slate-200 bg-white/50'
        if (phase === 'place' && selectedColor) {
          if (placeable) {
            rowStyle = CS[selectedColor].rowHl + ' cursor-pointer'
          } else {
            rowStyle = 'border-slate-200 bg-slate-100/40 opacity-40'
          }
        }

        return (
          <div key={rowIndex} className="flex items-center gap-2">

            {/* ── Hand board row ── */}
            <button
              onClick={() => !gameOver && placeable && onPlace(rowIndex)}
              disabled={!placeable || gameOver}
              className={`
                flex items-center h-10 px-2 rounded-xl border-2 flex-1
                transition-all duration-150
                ${rowStyle}
                ${placeable && !gameOver ? 'active:scale-[0.97]' : ''}
              `}
            >
              {/* Row number */}
              <span className="text-[10px] text-slate-400 font-mono w-3 shrink-0">{rowIndex + 1}</span>
              {/* Tiles right-aligned */}
              <div className="flex gap-1 ml-auto items-center">
                {Array.from({ length: capacity - row.count }, (_, i) => (
                  <EmptySlot key={`e${i}`} />
                ))}
                {row.color &&
                  Array.from({ length: row.count }, (_, i) => (
                    <Tile key={`f${i}`} color={row.color!} />
                  ))}
              </div>
            </button>

            {/* ── Wall row ── */}
            <div className="flex gap-1 shrink-0">
              {Array.from({ length: 5 }, (_, col) => {
                const color = getWallColor(rowIndex, col)
                const filled = wall[rowIndex][col]
                const isPopping = popCell?.row === rowIndex && popCell?.col === col

                return (
                  <div
                    key={col}
                    className={`
                      w-7 h-7 rounded-lg border-2 flex items-center justify-center shrink-0
                      transition-all duration-300
                      ${filled ? CS[color].tile : CS[color].faint}
                      ${isPopping ? 'animate-tile-pop' : ''}
                    `}
                  >
                    {!filled && (
                      <span className={`text-[8px] font-bold opacity-35 ${CS[color].text}`}>
                        {COLOR_LABEL[color]}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

          </div>
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────
//  Game Over Modal
// ──────────────────────────────────────────────
function GameOverModal({
  breakdown, score, turn, onReset,
}: {
  breakdown: FinalBreakdown; score: number; turn: number; onReset: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="animate-fade-in w-full max-w-xs bg-white rounded-2xl shadow-2xl p-5">
        <h2 className="text-xl font-black text-slate-800 text-center mb-1">ゲーム終了</h2>
        <p className="text-xs text-slate-400 text-center mb-4">{turn - 1} ターン</p>
        <div className="text-center mb-4">
          <div className="text-5xl font-black text-indigo-600 tabular-nums">{score}</div>
          <div className="text-xs text-slate-400 mt-0.5">合計得点</div>
        </div>
        <div className="bg-slate-50 rounded-xl p-3 mb-4 text-xs space-y-1.5">
          <div className="flex justify-between text-slate-600">
            <span>タイル配置得点</span>
            <span className="font-bold tabular-nums">{breakdown.baseScore}</span>
          </div>
          {breakdown.rowBonus > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>横一列ボーナス ×{breakdown.completedRows}</span>
              <span className="font-bold tabular-nums text-emerald-600">+{breakdown.rowBonus}</span>
            </div>
          )}
          {breakdown.colBonus > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>縦一列ボーナス ×{breakdown.completedCols}</span>
              <span className="font-bold tabular-nums text-emerald-600">+{breakdown.colBonus}</span>
            </div>
          )}
          {breakdown.colorBonus > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>同色5枚ボーナス ×{breakdown.completedColors}</span>
              <span className="font-bold tabular-nums text-emerald-600">+{breakdown.colorBonus}</span>
            </div>
          )}
          <div className="border-t border-slate-200 pt-1.5 flex justify-between font-black text-slate-800">
            <span>合計</span>
            <span className="text-indigo-600 tabular-nums">{score}</span>
          </div>
        </div>
        <button
          onClick={onReset}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-sm transition-colors"
        >
          もう一度プレイ
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
//  How To Play
// ──────────────────────────────────────────────
function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="animate-fade-in w-full max-w-xs bg-white rounded-2xl shadow-2xl p-5">
        <h2 className="text-lg font-black text-slate-800 mb-3">遊び方</h2>
        <ol className="text-sm text-slate-600 space-y-2 list-decimal list-inside">
          <li>マーケットから色を1つ選ぶ（その色をすべて取得）</li>
          <li>手元ボードの行に置く（同色のみ・各行に上限あり）</li>
          <li>行が満杯になると右の壁へ自動移動して得点</li>
          <li>置ける行がない場合は「捨てる」を押して破棄</li>
          <li>壁の横一列が完成するとゲーム終了</li>
        </ol>
        <div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-xl p-2.5 space-y-0.5">
          <div>配置得点：隣接タイル1枚につき+1点（孤立は+1点）</div>
          <div>ボーナス：横一列+2 / 縦一列+7 / 同色5枚+10</div>
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition-colors"
        >
          はじめる
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
//  Root
// ──────────────────────────────────────────────
export default function TileYardGame() {
  const [state, dispatch] = useReducer(gameReducer, undefined, createInitialState)
  const [showHelp, setShowHelp] = useState(true)
  const [popCell, setPopCell] = useState<{ row: number; col: number } | null>(null)

  // Trigger pop animation when a tile lands on the wall
  useEffect(() => {
    if (!state.animatingCell) return
    setPopCell(state.animatingCell)
    const t = setTimeout(() => setPopCell(null), 500)
    return () => clearTimeout(t)
  }, [state.animatingCell])

  const handleReset = () => {
    dispatch({ type: 'RESET' })
    setShowHelp(false)
  }

  return (
    <div className="h-[100dvh] overflow-hidden flex flex-col bg-gradient-to-b from-slate-100 to-blue-50 max-w-lg mx-auto w-full">

      <Header
        score={state.score}
        round={state.round}
        turn={state.turn}
        onReset={handleReset}
        onHelp={() => setShowHelp(true)}
      />

      <PhaseBar
        state={state}
        onDiscard={() => dispatch({ type: 'DISCARD_HELD' })}
      />

      <MarketArea
        state={state}
        onSelect={color => dispatch({ type: 'SELECT_COLOR', color })}
      />

      {/* Unified game grid fills remaining space */}
      <div className="flex-1 overflow-hidden flex items-center px-3 py-3">
        <GameGrid
          state={state}
          popCell={popCell}
          onPlace={i => dispatch({ type: 'PLACE_ON_ROW', rowIndex: i })}
        />
      </div>

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

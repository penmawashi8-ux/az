import {
  Color,
  COLORS,
  FinalBreakdown,
  GameState,
  HandRow,
  getWallCol,
} from './gameTypes'

// ──────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────
function generateMarket(): Color[] {
  return Array.from(
    { length: 5 },
    () => COLORS[Math.floor(Math.random() * COLORS.length)],
  )
}

/**
 * Placement score when a tile lands on wall[row][col].
 * +1 for each orthogonal neighbour that is already filled.
 * Minimum 1 when isolated.
 */
function placementScore(wall: boolean[][], row: number, col: number): number {
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  let adj = 0
  for (const [dr, dc] of dirs) {
    const r = row + dr, c = col + dc
    if (r >= 0 && r < 5 && c >= 0 && c < 5 && wall[r][c]) adj++
  }
  return adj === 0 ? 1 : adj
}

function calcFinalBreakdown(wall: boolean[][], baseScore: number): FinalBreakdown {
  // Row bonuses (+2 each)
  let rowBonus = 0, completedRows = 0
  for (let r = 0; r < 5; r++) {
    if (wall[r].every(Boolean)) { rowBonus += 2; completedRows++ }
  }

  // Column bonuses (+7 each)
  let colBonus = 0, completedCols = 0
  for (let c = 0; c < 5; c++) {
    if (wall.every(row => row[c])) { colBonus += 7; completedCols++ }
  }

  // Color bonuses (+10 each)
  let colorBonus = 0, completedColors = 0
  for (const color of COLORS) {
    const done = Array.from({ length: 5 }, (_, r) => wall[r][getWallCol(r, color)])
      .every(Boolean)
    if (done) { colorBonus += 10; completedColors++ }
  }

  return {
    baseScore,
    rowBonus,
    colBonus,
    colorBonus,
    total: baseScore + rowBonus + colBonus + colorBonus,
    completedRows,
    completedCols,
    completedColors,
  }
}

// ──────────────────────────────────────────────
//  Initial state factory
// ──────────────────────────────────────────────
export function createInitialState(): GameState {
  return {
    market: generateMarket(),
    selectedColor: null,
    selectedCount: 0,
    handRows: Array.from({ length: 5 }, (): HandRow => ({ color: null, count: 0 })),
    wall: Array.from({ length: 5 }, () => Array<boolean>(5).fill(false)),
    score: 0,
    round: 1,
    turn: 1,
    phase: 'select',
    gameOver: false,
    finalBreakdown: null,
    animatingCell: null,
  }
}

// ──────────────────────────────────────────────
//  Reducer
// ──────────────────────────────────────────────
export type GameAction =
  | { type: 'SELECT_COLOR'; color: Color }
  | { type: 'PLACE_ON_ROW'; rowIndex: number }
  | { type: 'RESET' }

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    // ── Reset ──────────────────────────────────
    case 'RESET':
      return createInitialState()

    // ── Pick a colour from the market ──────────
    case 'SELECT_COLOR': {
      if (state.phase !== 'select' || state.gameOver) return state
      const count = state.market.filter(c => c === action.color).length
      if (count === 0) return state

      return {
        ...state,
        market: state.market.filter(c => c !== action.color),
        selectedColor: action.color,
        selectedCount: count,
        phase: 'place',
        animatingCell: null,
      }
    }

    // ── Place tiles on a hand-board row ────────
    case 'PLACE_ON_ROW': {
      if (state.phase !== 'place' || !state.selectedColor || state.gameOver) return state

      const { rowIndex } = action
      const capacity = rowIndex + 1
      const handRow = state.handRows[rowIndex]

      // Validate: row must not be full, must be same colour or empty,
      // and the wall slot for this colour in this row must be empty.
      if (handRow.count >= capacity) return state
      if (handRow.color !== null && handRow.color !== state.selectedColor) return state
      if (state.wall[rowIndex][getWallCol(rowIndex, state.selectedColor)]) return state

      // Fill the row (cap at capacity; extras are silently discarded)
      const newCount = Math.min(handRow.count + state.selectedCount, capacity)
      const newHandRows: HandRow[] = state.handRows.map((r, i) =>
        i === rowIndex ? { color: state.selectedColor as Color, count: newCount } : { ...r },
      )

      // Deep-copy the wall so we can mutate it
      const newWall = state.wall.map(r => [...r])
      let newScore = state.score
      let animatingCell: GameState['animatingCell'] = null
      let gameOver = false
      let finalBreakdown: FinalBreakdown | null = null

      // ── Row completed → move tile to wall ────
      if (newCount >= capacity) {
        const wallCol = getWallCol(rowIndex, state.selectedColor)
        newScore += placementScore(newWall, rowIndex, wallCol)
        newWall[rowIndex][wallCol] = true
        newHandRows[rowIndex] = { color: null, count: 0 }
        animatingCell = { row: rowIndex, col: wallCol }

        // Game-over check: any wall row fully filled?
        for (let r = 0; r < 5; r++) {
          if (newWall[r].every(Boolean)) {
            gameOver = true
            break
          }
        }
        if (gameOver) {
          finalBreakdown = calcFinalBreakdown(newWall, newScore)
          newScore = finalBreakdown.total
        }
      }

      // Replenish market when empty (unless game just ended)
      let newMarket = state.market
      let newRound = state.round
      if (state.market.length === 0 && !gameOver) {
        newMarket = generateMarket()
        newRound = state.round + 1
      }

      return {
        ...state,
        handRows: newHandRows,
        wall: newWall,
        score: newScore,
        market: newMarket,
        round: newRound,
        turn: state.turn + 1,
        selectedColor: null,
        selectedCount: 0,
        phase: 'select',
        gameOver,
        finalBreakdown,
        animatingCell,
      }
    }

    default:
      return state
  }
}

// ──────────────────────────────────────────────
//  Query helpers (for the UI)
// ──────────────────────────────────────────────

/** Can the player place on `rowIndex` right now? */
export function canPlaceOnRow(state: GameState, rowIndex: number): boolean {
  if (state.phase !== 'place' || !state.selectedColor) return false
  const { handRows, wall, selectedColor } = state
  const capacity = rowIndex + 1
  const row = handRows[rowIndex]
  if (row.count >= capacity) return false
  if (row.color !== null && row.color !== selectedColor) return false
  if (wall[rowIndex][getWallCol(rowIndex, selectedColor)]) return false
  return true
}

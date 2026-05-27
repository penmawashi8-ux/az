// ──────────────────────────────────────────────
//  Color definitions
// ──────────────────────────────────────────────
export type Color = 'blue' | 'yellow' | 'red' | 'purple' | 'green'

/**
 * The 5 tile colors used in the game.
 * Order matters: COLORS[i] is also the default left-to-right column order in row 0.
 */
export const COLORS: Color[] = ['blue', 'yellow', 'red', 'purple', 'green']

export const COLOR_LABEL: Record<Color, string> = {
  blue:   '青',
  yellow: '黄',
  red:    '赤',
  purple: '紫',
  green:  '緑',
}

// ──────────────────────────────────────────────
//  Wall color layout
//
//  wall[row][col] = COLORS[(col − row + 5) % 5]
//
//  Row 0: blue   yellow red    purple green
//  Row 1: green  blue   yellow red    purple
//  Row 2: purple green  blue   yellow red
//  Row 3: red    purple green  blue   yellow
//  Row 4: yellow red    purple green  blue
// ──────────────────────────────────────────────
export function getWallColor(row: number, col: number): Color {
  return COLORS[(col - row + 5) % 5]
}

/** Which column in `row` receives tiles of `color`? */
export function getWallCol(row: number, color: Color): number {
  return (COLORS.indexOf(color) + row) % 5
}

// ──────────────────────────────────────────────
//  Game state types
// ──────────────────────────────────────────────
export interface HandRow {
  color: Color | null
  count: number
}

export interface FinalBreakdown {
  baseScore: number
  rowBonus: number      // +2 per completed wall row
  colBonus: number      // +7 per completed wall column
  colorBonus: number    // +10 per completed color (all 5 placed)
  total: number
  completedRows: number
  completedCols: number
  completedColors: number
}

export interface GameState {
  /** Tiles currently visible in the market */
  market: Color[]
  /** Color the player chose from the market (null = not yet chosen) */
  selectedColor: Color | null
  /** How many tiles of selectedColor were taken */
  selectedCount: number
  /** 5 rows; index 0 = row with capacity 1, index 4 = capacity 5 */
  handRows: HandRow[]
  /** 5×5 grid: wall[row][col] = true when that cell is filled */
  wall: boolean[][]
  score: number
  round: number
  turn: number
  /** 'select' = pick from market; 'place' = choose a hand-board row */
  phase: 'select' | 'place'
  gameOver: boolean
  finalBreakdown: FinalBreakdown | null
  /** The wall cell that was just placed (for pop animation) */
  animatingCell: { row: number; col: number } | null
}

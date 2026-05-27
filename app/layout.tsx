import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'タイルヤード',
  description: 'アズール風の1人用タイル配置パズルゲーム',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}

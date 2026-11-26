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
      <head>
        {/* 懸賞リストのワンボタン応募スクリプトが付ける目印を、Reactの描画で消える前に控えておく */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var c=function(){var v=document.documentElement.getAttribute('data-kensho-x');if(v)window.__kenshoX=v};c();document.addEventListener('DOMContentLoaded',c);window.addEventListener('kensho-x-ready',c)})()",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}

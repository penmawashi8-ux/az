import type { Metadata } from 'next'
import KenshoList from '@/components/KenshoList'

export const metadata: Metadata = {
  title: '懸賞リスト',
  description: '毎時自動収集したプレゼントキャンペーンをスコア順に表示',
}

export default function KenshoPage() {
  return <KenshoList />
}

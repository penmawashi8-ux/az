# 懸賞リスト（自動収集）

- `collect.py` … PR TIMES / @Press の公開RSSとPR TIMESのタグページから、抽選プレゼント系のリリースを拾い、締切・当選数・応募方法・応募URLを抽出してスコア付け（標準ライブラリのみ）
- `notify.py` … 新着をntfy.shでプッシュ通知（任意）
- `.github/workflows/kensho.yml` … 毎時実行し、結果を `kensho-data` ブランチ（data.json）へ強制push
- 画面 … `/kensho`（`components/KenshoList.tsx`）。応募済み/スキップとプロフィールはブラウザ内だけに保存

ローカル実行: `python3 kensho/collect.py` → `public/kensho/data.json`

方針: 応募の最終送信・CAPTCHA・SNSのフォロー/リポストは自動化しない（規約違反・当選無効・凍結の回避）。

## 実行のしかた
- GitHub の定期実行（schedule）はこのリポジトリでは発火しないため、`kensho/` 以下の変更を main に push すると収集・自動応募が1回走る。
- GitHub アプリ／Web の Actions → kensho-collect →「Run workflow」でも実行できる。

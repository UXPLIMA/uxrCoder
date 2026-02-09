# AI Quickstart (Son Kullanici)

Bu dokuman, herhangi bir AI ajana uxrCoder uzerinden Roblox oyununu duzenletmenin en hizli ve stabil yoludur.

## 1. Dogru Klasoru Ac

AI aracinda sadece `server/` degil, **oyun workspace kok klasorunu** ac.

Ajan su dosyalari gorebilmeli:
- oyun dosyalari (`workspace/` mapping)
- `AGENTS.md` talimat dosyasi

## 2. uxrCoder'i Baslat

`uxrCoder` repo kokunden:

```bash
npm run dev
```

Roblox Studio icinde:
- uxrCoder pluginini ac
- initial sync calistir

Server kontrolu:

```bash
curl http://127.0.0.1:34872/health
```

## 3. Ajana Sabit Kural Dosyasi Ver

`AGENTS.md` dosyasini otomatik uret:

```bash
npm run agent:init -- --project /path/to/MyGame --force
```

Bu komut:
- erisilebilir server URL'ini bulur (`localhost` veya LAN IP),
- bu URL'i sablona enjekte eder,
- `/path/to/MyGame/AGENTS.md` dosyasini yazar.

Ilk mesajin sadece su olabilir:

```text
AGENTS.md dosyasini oku ve <ozellik> gelistir.
```

Ornek:

```text
AGENTS.md dosyasini oku ve server-side dogrulamali coin toplama sistemi yaz, sonra smoke test kos.
```

## 4. Neden Daha Iyi Calisir

- Ajan ilk olarak `GET /agent/bootstrap` cagirir, health + capabilities + snapshot + schema tek cagriyla gelir.
- Path formati net olur (`path` array + `pathString` string).
- Test response parse daha saglam olur (`id/status` top-level, gerekirse `run.*` fallback).
- Her yeni sohbette uzun manuel prompt yazma ihtiyaci azalir.

## 5. Hata Politikai (Onemli)

- `GET /health` basarisizsa ajan durmali ve engeli raporlamali.
- Canli Studio gorevlerinde fallback olarak dogrudan dosya duzenlemeye gecmemeli.
- Gorev ancak test run ID ve final status raporlaninca tamam sayilir.

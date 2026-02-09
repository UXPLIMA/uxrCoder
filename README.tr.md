<p align="right">
  <a href="./README.md">English</a> | <a href="./README.tr.md"><strong>Türkçe</strong></a>
</p>

<h1 align="center">uxrCoder</h1>

<p align="center">
  Roblox Studio ↔ VS Code/AI senkronizasyonunu deterministik, test edilebilir ve yayın kalitesinde yöneten platform.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/Lisans-MIT-yellow.svg" alt="MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-18%2B-green" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-blue" alt="TypeScript"></a>
  <img src="https://img.shields.io/badge/S%C3%BCr%C3%BCm-v1.1.0-orange" alt="Sürüm v1.1.0">
</p>

## uxrCoder Ne Çözer?

uxrCoder; Roblox Studio, yerel dosya sistemi, VS Code ve AI agent akışlarını tek bir deterministik proje durumunda tutar.

Hedef kullanım:
- VS Code üzerinden günlük script/property geliştirme,
- AI agentlerin Explorer benzeri güvenilir işlem yapabilmesi,
- otonom test akışları ve artifact üretimi,
- conflict/hata durumlarında tekrar üretilebilir debug.

## Öne Çıkan Yetenekler

### 1) Deterministik Çift Yönlü Sync
- Plugin -> server sync (`/sync`, `/sync/delta`).
- Editor/server -> plugin değişiklik kuyruğu (`/changes`, `/changes/confirm`).
- Çakışma güvenli isimlendirme (`Folder`, `Folder_2`, `Folder_3`, ...).
- Reparent/rename sonrası stabil `id -> path` çözümleme.

### 2) Agent Control Plane
- Yetenek keşif API'si: `GET /agent/capabilities`
- Snapshot API: `GET /agent/snapshot`
- Property schema API: `GET /agent/schema/properties`
- Command API: `POST /agent/command`, `POST /agent/commands`
- Locking, revision check, idempotency, conflict payload yapısı.
- Property güncellemelerinde plugin kuyruğundan önce doğrulama.

### 3) Otonom Playtest Altyapısı
- Test orkestrasyon endpointleri (`/agent/tests/*`).
- Plugin tarafı step runner (assert + mutation).
- Harness entegrasyonu (`BindableFunction`, `BindableEvent`, `ModuleScript`).
- Isolation cleanup (create/destroy/property rollback best-effort).
- Screenshot artifact ve opsiyonel baseline assert/record akışı.

### 4) Gözlemlenebilirlik ve Debug
- Test metrikleri: `GET /agent/tests/metrics`
- Lock teşhis: `GET /agent/locks`
- Repro bundle export: `POST /agent/debug/export`
- Performans profile: `GET /agent/debug/profile`
- 100k+ instance sentetik benchmark scripti.

### 5) Geliştirici Araçları
- VS Code Roblox Explorer + Property Editor + Class Browser.
- `.rbxlx` ve `.rbxmx` build/export endpointleri.
- Luau araçları için sourcemap yenileme endpointi.

## Hızlı Başlangıç

1. Bağımlılıkları kur
```bash
npm run setup
```

2. Sync server başlat
```bash
npm run dev
```

3. Roblox plugin kur
- `plugin/RobloxSyncPlugin.lua` dosyasını Roblox local plugin klasörüne kopyala.

4. VS Code extension host çalıştır
- `vscode-extension/` klasörünü aç, `F5` ile Extension Development Host başlat.

5. Sağlık kontrolü
```bash
curl http://127.0.0.1:34872/health
```

## AI Agent Başlangıç (En Kısa Yol)

1. Oyun kökü için `AGENTS.md` üret:
```bash
npm run agent:init -- --project /path/to/MyGame --force
```

2. AI sohbetine şunu yaz:
```text
AGENTS.md dosyasını oku ve akışı aynen uygula.
```

Notlar:
- Şablon ilk adımda `GET /agent/bootstrap` çağrısını zorunlu kılar.
- Şablon `GET /agent/schema/commands` çağrısını zorunlu kılar; payload deneme-yanılma ihtiyacını azaltır.
- Böylece `path` formatı ve test response alanları tahmin edilmez, doğrudan keşfedilir.

## Dokümantasyon

- Kurulum: `docs/INSTALLATION.md`
- Kullanım akışları: `docs/USAGE.md`
- Konfigürasyon referansı: `docs/CONFIGURATION.md`
- Mimari: `docs/ARCHITECTURE.md`
- Agent API referansı: `docs/AGENT_API.md`
- AI quickstart (EN): `docs/AI_QUICKSTART.md`
- AI quickstart (TR): `docs/AI_QUICKSTART.tr.md`
- AGENTS şablonu: `docs/AGENTS_TEMPLATE.md`
- Agent test harness rehberi: `docs/agent-test-harness.md`
- Uçtan uca tutorial (EN): `docs/TUTORIAL.md`
- Uçtan uca tutorial (TR): `docs/TUTORIAL.tr.md`
- Release checklist: `docs/RELEASE_CHECKLIST.md`

## Sürüm Durumu

Bu repo `v1.1.0` yayın hazırlığına uygundur:
- server testleri geçiyor,
- server + extension build geçiyor,
- çok dilli README ve güncel dokümantasyon hazır,
- roadmap release kapanışına göre güncel.

## Katkı ve Güvenlik

- Katkı rehberi: `CONTRIBUTING.md`
- Güvenlik politikası: `SECURITY.md`
- Değişiklik günlüğü: `CHANGELOG.md`
- Yol haritası: `ROADMAP.md`

## Lisans

MIT. `LICENSE` dosyasına bakın.

<p align="right">
  <a href="./README.md">English</a> | <a href="./README.tr.md"><strong>Türkçe</strong></a>
</p>

<h1 align="center">uxrCoder</h1>

<p align="center">
  Roblox Studio ↔ VS Code geliştirme sürecini deterministik, izlenebilir ve otomasyona uygun hale getiren platform.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/Lisans-MIT-yellow.svg" alt="MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-18%2B-green" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-blue" alt="TypeScript"></a>
  <img src="https://img.shields.io/badge/S%C3%BCr%C3%BCm-v1.1.0-orange" alt="Sürüm v1.1.0">
</p>

## Genel Bakış

`uxrCoder`; Roblox Studio durumu, yerel dosyalar ve VS Code araçlarını tek bir tutarlı proje durumu etrafında toplar.

Hedeflediği ekipler:
- Studio ve dosya sistemi arasında çift yönlü, tutarlı senkron isteyenler,
- API üzerinden güvenli nesne/property değişikliği yönetmek isteyenler,
- otomatik test koşup rapor/artifact saklamak isteyenler,
- hata durumlarını tekrar üretilebilir şekilde analiz etmek isteyenler.

## Neden uxrCoder?

- Rename/reparent çakışmalarında deterministik sonuç.
- `id`, `path` ve `revision` tabanlı stabil hedefleme.
- Property değişikliklerinde schema destekli doğrulama.
- Otomasyon ve assistant entegrasyonuna uygun API yüzeyi.
- Kuyruk, retry, isolation cleanup ve artifact içeren test altyapısı.
- Repro bundle ve profile endpointleriyle hızlı triage.

## Ana Yetenekler

### 1. Canlı Senkronizasyon Katmanı
- Plugin -> server: `POST /sync`, `POST /sync/delta`
- Server/editor -> plugin kuyruk: `GET /changes`, `POST /changes/confirm`
- Dosya yansıtma + watcher döngü koruması
- Deterministik kardeş isimlendirme ve stabil `id -> path` çözümleme

### 2. Otomasyon ve Kontrol Katmanı
- Başlangıç keşfi: `GET /agent/bootstrap`, `GET /agent/capabilities`
- Durum ve schema: `GET /agent/snapshot`, `GET /agent/schema/properties`, `GET /agent/schema/commands`
- Komutlar: `POST /agent/command`, `POST /agent/commands`
- Güvenlik mekanizmaları: lock manager, idempotency key, base revision kontrolü, conflict payload modeli

### 3. Otonom Test Katmanı
- Senaryo çalıştırma: `POST /agent/tests/run`
- Çalışma yaşam döngüsü: `GET /agent/tests`, `GET /agent/tests/:id`, `POST /agent/tests/:id/abort`
- Event alım ve kayıt: `POST /agent/tests/events`
- Rapor ve artifact: `GET /agent/tests/:id/report`, `GET /agent/tests/:id/artifacts`
- Ekran görüntüsü baseline modları: `assert`, `record`, `assert_or_record`

### 4. Gözlemlenebilirlik ve Debug
- Kuyruk/çalışma metrikleri: `GET /agent/tests/metrics`
- Lock teşhisleri: `GET /agent/locks`
- Repro bundle export: `POST /agent/debug/export`
- Sıcak nokta profilleme: `GET /agent/debug/profile`

### 5. VS Code Eklenti Akışı
- Explorer tree, property editor, class browser
- Insert/rename/delete ve reparent dostu düzenleme komutları
- Script açma/düzenleme akışı
- Runtime/build komutları ve sourcemap yenileme

## Hızlı Başlangıç

1. Bağımlılıkları kur
```bash
npm run setup
```

2. Sunucuyu başlat
```bash
npm run dev
```

3. Roblox plugin kur
- `plugin/RobloxSyncPlugin.lua` dosyasını yerel Roblox plugin klasörüne kopyala.

4. VS Code extension host çalıştır
- `vscode-extension/` klasörünü VS Code ile aç ve `F5` ile başlat.

5. Sağlık kontrolü
```bash
curl http://127.0.0.1:34872/health
```

## Assistant İçin Hızlı Onboarding

Oyun çalışma klasöründe `AGENTS.md` oluştur:

```bash
npm run agent:init -- --project /path/to/MyGame --force
```

İlk mesaj olarak şu yeterlidir:

```text
AGENTS.md dosyasını oku ve <özellik> geliştir; ardından test koşup run ID ve final durumu raporla.
```

## Dokümantasyon

- Ana README (EN): `README.md`
- Dokümantasyon indeksi (EN): `docs/README.md`
- Dokümantasyon indeksi (TR): `docs/README.tr.md`
- Kurulum: `docs/INSTALLATION.md`
- Kullanım akışları: `docs/USAGE.md`
- Konfigürasyon referansı: `docs/CONFIGURATION.md`
- Mimari: `docs/ARCHITECTURE.md`
- API referansı: `docs/AGENT_API.md`
- Assistant quickstart (EN): `docs/AI_QUICKSTART.md`
- Assistant quickstart (TR): `docs/AI_QUICKSTART.tr.md`
- AGENTS şablonu: `docs/AGENTS_TEMPLATE.md`
- Test harness rehberi: `docs/agent-test-harness.md`
- Uçtan uca tutorial (EN): `docs/TUTORIAL.md`
- Uçtan uca tutorial (TR): `docs/TUTORIAL.tr.md`
- Release checklist: `docs/RELEASE_CHECKLIST.md`

## Proje Durumu

Güncel sürüm hattı: `v1.1.0`.

Depoda şu katmanlar hazır durumdadır:
- Studio ↔ dosya sistemi ↔ extension arasında production seviyesinde sync akışı,
- schema ve conflict kontratları ile otomasyon API seti,
- otonom test, artifact ve rapor saklama,
- debug/profile endpointleri ve release dokümantasyonu.

## Katkı ve Güvenlik

- Katkı rehberi: `CONTRIBUTING.md`
- Güvenlik politikası: `SECURITY.md`
- Değişiklik geçmişi: `CHANGELOG.md`
- Yol haritası: `ROADMAP.md`

## Lisans

MIT. Ayrıntı için `LICENSE` dosyasına bak.

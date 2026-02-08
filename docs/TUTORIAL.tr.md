# Tutorial: Uçtan Uca Akış

Bu tutorial, uxrCoder ile tam bir akışı gösterir:
1. kurulum
2. sync doğrulama
3. agent command çalıştırma
4. otonom test run
5. debug bundle export

## Adım 1: Kurulum

Repo kökünde:

```bash
npm run setup
npm run dev
```

Paralelde:
- `plugin/RobloxSyncPlugin.lua` dosyasını Roblox local plugin klasörüne kur
- `vscode-extension/` klasöründen `F5` ile extension host aç

## Adım 2: İlk Sync

Roblox Studio içinde:
- plugini aktif et
- initial sync çalıştır

Server health kontrolü:

```bash
curl http://127.0.0.1:34872/health
```

Beklenen:
- `status: "ok"`
- `instanceCount > 0`

## Adım 3: Snapshot ve Schema Oku

```bash
curl http://127.0.0.1:34872/agent/snapshot
curl "http://127.0.0.1:34872/agent/schema/properties?className=Part"
```

Deterministik hedefleme için snapshot `id` değerlerini kullan.

## Adım 4: Agent API ile Create/Rename

`ReplicatedStorage` altına klasör oluştur:

```bash
curl -X POST http://127.0.0.1:34872/agent/command \
  -H 'Content-Type: application/json' \
  -H 'x-idempotency-key: tutorial-create-1' \
  -d '{
    "command": {
      "op": "create",
      "parentPath": ["ReplicatedStorage"],
      "className": "Folder",
      "name": "TutorialFolder"
    }
  }'
```

Yeniden adlandır:

```bash
curl -X POST http://127.0.0.1:34872/agent/command \
  -H 'Content-Type: application/json' \
  -d '{
    "command": {
      "op": "rename",
      "targetPath": ["ReplicatedStorage", "TutorialFolder"],
      "name": "TutorialFolder_Main"
    }
  }'
```

## Adım 5: Otonom Test Çalıştır

```bash
curl -X POST http://127.0.0.1:34872/agent/tests/run \
  -H 'Content-Type: application/json' \
  -d '{
    "scenario": {
      "name": "tutorial smoke",
      "safety": {
        "allowDestructiveActions": false,
        "maxRetries": 1
      },
      "steps": [
        { "type": "assertExists", "path": ["ReplicatedStorage", "TutorialFolder_Main"] },
        { "type": "captureArtifact", "name": "tutorial-folder", "path": ["ReplicatedStorage", "TutorialFolder_Main"] }
      ]
    }
  }'
```

Run listesini izle:

```bash
curl http://127.0.0.1:34872/agent/tests
```

## Adım 6: Report ve Artifact Oku

`<runId>` yerine gerçek id koy:

```bash
curl http://127.0.0.1:34872/agent/tests/<runId>/report
curl http://127.0.0.1:34872/agent/tests/<runId>/artifacts
```

## Adım 7: Debug Bundle Export

```bash
curl -X POST http://127.0.0.1:34872/agent/debug/export \
  -H 'Content-Type: application/json' \
  -d '{"persist": true, "includeBundle": false, "label": "tutorial"}'
```

Çıktı dizini:
- `workspace/.uxr-debug/`

## Adım 8: Profil (Opsiyonel)

```bash
curl "http://127.0.0.1:34872/agent/debug/profile?iterations=5&sampleSize=5000&includeSchema=true"
```

## Adım 9: Release Öncesi Doğrulama

```bash
npm --prefix server test -- --run
npm --prefix server run build
npm run build
```

Bu adımlar geçiyorsa sürüm yayın hazırlığı tamamdır.

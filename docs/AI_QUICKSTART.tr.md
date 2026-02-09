# Assistant Hızlı Başlangıç

Bu doküman, bir assistant aracının uxrCoder ile güvenli ve hızlı şekilde çalışması için en kısa akışı anlatır.

## 1. Doğru Klasörü Aç

Assistant aracında sadece `server/` değil, oyun workspace kök klasörünü aç.

Assistant şu dosyaları görebilmeli:
- oyun dosyaları ve mapping kökü
- `AGENTS.md` talimat dosyası

## 2. uxrCoder'i Başlat

Repo kökünden:

```bash
npm run dev
```

Roblox Studio içinde:
- uxrCoder pluginini aç
- initial sync çalıştır

Doğrulama:

```bash
curl http://127.0.0.1:34872/health
```

## 3. Sabit Kural Dosyası Üret

```bash
npm run agent:init -- --project /path/to/MyGame --force
```

Bu komut:
- erişilebilir server URL'ini bulur (`localhost` veya LAN IP),
- bu URL'i şablona ekler,
- `/path/to/MyGame/AGENTS.md` dosyasını yazar.

Dosya adı zorunluluğu:
- talimat dosya adı tam olarak `AGENTS.md` olmalıdır.

## 4. İlk Prompt Örneği

```text
AGENTS.md dosyasını oku ve <özellik> geliştir; ardından test koşup run ID ve final durumu raporla.
```

Örnek:

```text
AGENTS.md dosyasını oku ve server-side doğrulamalı coin toplama sistemi geliştir; sonra smoke test koş.
```

Test koşarken runtime modu belirt:

```json
{
  "runtime": { "mode": "play", "stopOnFinish": true }
}
```

## 5. Bu Akış Neden Sağlam?

- `GET /agent/bootstrap` ile health + capabilities + opsiyonel snapshot/schema tek çağrıda gelir.
- `GET /agent/schema/commands`, payload tahminini ortadan kaldırır.
- `path` (array) ve `pathString` (string) formatları net ve hedefleme için uygundur.
- Test cevapları hem top-level (`id`, `status`) hem `run.*` fallback ile uyumludur.

## 6. Hata Politikası

- `GET /health` başarısızsa dur ve engeli raporla.
- Canlı Studio görevlerinde doğrudan dosya düzenlemeye fallback yapma.
- Payload formatı öğrenmek için probe write kullanma.
- Play runtime başlatılamazsa blocker olarak raporla.
- Görev, run ID ve final durum raporlanmadan tamamlanmış sayılmaz.

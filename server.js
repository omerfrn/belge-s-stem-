const express = require('express');
const session = require('express-session');
const multer = require('multer');
const QRCode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Gerekli klasörler
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
if (!fs.existsSync('./public/qrcodes')) fs.mkdirSync('./public/qrcodes', { recursive: true });

// Veritabanı
const db = new sqlite3.Database('./database.sqlite');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        filename TEXT,
        verify_code TEXT UNIQUE,
        qr_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: 'frnsan_gizli_anahtar_99',
    resave: false,
    saveUninitialized: true
}));

const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Giriş Kontrolü
const authMiddleware = (req, res, next) => {
    if (req.session.isLoggedIn) return next();
    res.redirect('/login');
};

// --- FRNSAN LOGO VE HEADER BİLEŞENİ ---
const getHeader = (user = null) => `
    <header style="background:#ffffff; border-bottom:2px solid #e0e0e0; padding:15px 20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px;">
        <div style="display:flex; align-items:center; gap:12px;">
            <!-- FRNSAN Globe Logo SVG -->
            <svg width="42" height="42" viewBox="0 0 100 100">
                <defs>
                    <linearGradient id="globeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#2b7fff"/>
                        <stop offset="100%" stop-color="#0a43a8"/>
                    </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="45" fill="url(#globeGrad)"/>
                <path d="M 8,35 Q 50,15 92,35 M 5,50 Q 50,30 95,50 M 8,65 Q 50,45 92,65 M 18,80 Q 50,60 82,80" fill="none" stroke="#ffffff" stroke-width="5"/>
            </svg>
            <span style="font-size:26px; font-weight:900; font-family:sans-serif; letter-spacing:1px; color:#111;">FRNSAN</span>
        </div>
        <nav style="display:flex; gap:15px; font-family:sans-serif; align-items:center; flex-wrap:wrap;">
            <a href="/" style="text-decoration:none; color:#333; font-weight:bold;">Ana Sayfa</a>
            <a href="/#piyasa" style="text-decoration:none; color:#333; font-weight:bold;">Piyasa Verileri</a>
            <a href="/#haberler" style="text-decoration:none; color:#333; font-weight:bold;">Tarım & Hayvancılık</a>
            <a href="/verify" style="text-decoration:none; color:#28a745; font-weight:bold;">✔ Belge Doğrulama</a>
            ${user ? `<a href="/admin" style="background:#007bff; color:white; padding:6px 12px; border-radius:4px; text-decoration:none;">Yönetim Paneli</a>
                     <a href="/logout" style="color:red; text-decoration:none;">Çıkış Yap (${user})</a>` 
                  : `<a href="/login" style="background:#17a2b8; color:white; padding:6px 12px; border-radius:4px; text-decoration:none;">Giriş Yap</a>`}
        </nav>
    </header>
`;

// --- HERKESE AÇIK ANA SAYFA ---
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>FRNSAN - Tarım, Hayvancılık ve Belge Portalı</title>
            <style>
                body { font-family: Arial, sans-serif; margin:0; padding:0; background:#f4f6f9; color:#333; }
                .container { max-width: 1100px; margin: 20px auto; padding: 0 15px; }
                .market-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
                .market-card { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); text-align: center; border-top: 4px solid #007bff; }
                .market-card h4 { margin: 0 0 8px 0; color: #666; font-size: 14px; }
                .market-card .val { font-size: 22px; font-weight: bold; color: #111; }
                .news-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
                .news-card { background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
                .news-content { padding: 15px; }
                .news-tag { background: #28a745; color: white; padding: 3px 8px; border-radius: 3px; font-size: 12px; font-weight: bold; }
                .verify-box { background: #e8f5e9; border: 2px dashed #28a745; padding: 25px; border-radius: 8px; text-align: center; margin-bottom: 30px; }
            </style>
        </head>
        <body>
            ${getHeader(req.session.user)}

            <div class="container">
                <!-- CANLI PIYASA VERİLERİ -->
                <h2 id="piyasa">📊 Güncel Piyasa Verileri</h2>
                <div class="market-bar">
                    <div class="market-card" style="border-color:#e67e22;">
                        <h4>🌾 Ekmeklik Buğday</h4>
                        <div class="val">11.45 TL / kg</div>
                    </div>
                    <div class="market-card" style="border-color:#27ae60;">
                        <h4>💵 Dolar (USD)</h4>
                        <div class="val">34.20 TL</div>
                    </div>
                    <div class="market-card" style="border-color:#2980b9;">
                        <h4>💶 Euro (EUR)</h4>
                        <div class="val">38.10 TL</div>
                    </div>
                    <div class="market-card" style="border-color:#c0392b;">
                        <h4>⛽ Benzin (Litre)</h4>
                        <div class="val">43.50 TL</div>
                    </div>
                </div>

                <!-- HIZLI BELGE DOĞRULAMA KUTUSU -->
                <div class="verify-box">
                    <h3 style="margin-top:0; color:#1b5e20;">🔍 Hızlı Belge Doğrulama</h3>
                    <p>Elinizdeki belgenin üzerindeki doğrulama kodunu girerek orijinalliğini anında sorgulayın.</p>
                    <form action="/verify" method="GET" style="display:flex; justify-content:center; gap:10px; max-width:400px; margin:auto;">
                        <input type="text" name="code" placeholder="Örn: DOC-A1B2C3" style="padding:10px; width:70%; border:1px solid #ccc; border-radius:4px;" required>
                        <button type="submit" style="padding:10px 15px; background:#28a745; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">Sorgula</button>
                    </form>
                </div>

                <!-- TARIM VE HAYVANCILIK HABERLERİ -->
                <h2 id="haberler">🌾 Tarım ve Hayvancılık Haberleri</h2>
                <div class="news-grid">
                    <div class="news-card">
                        <div class="news-content">
                            <span class="news-tag">TARIM</span>
                            <h3 style="margin:10px 0;">2026 Yılı Hububat Destekleme Ödemeleri Başladı</h3>
                            <p style="color:#666; font-size:14px;">Tarım ve Orman Bakanlığı tarafından üreticilere sağlanacak mazot ve gübre desteklemeleri hesaplara aktarılmaya başlandı.</p>
                        </div>
                    </div>
                    <div class="news-card">
                        <div class="news-content">
                            <span class="news-tag" style="background:#17a2b8;">HAYVANCILIK</span>
                            <h3 style="margin:10px 0;">Hayvancılıkta Yeni Hibe ve Kredi Paketleri Açıklandı</h3>
                            <p style="color:#666; font-size:14px;">Damızlık hayvan alımı ve modern ağıl/ahır yapımı için uygun faizli kredi imkanları yetiştiricilere sunuluyor.</p>
                        </div>
                    </div>
                    <div class="news-card">
                        <div class="news-content">
                            <span class="news-tag" style="background:#e67e22;">TEKNOLOJİ</span>
                            <h3 style="margin:10px 0;">Akıllı Tarım Teknolojileriyle Verimlilik %30 Arttı</h3>
                            <p style="color:#666; font-size:14px;">Sulamada sensör kullanımı ve drone ile gübreleme teknikleri Türkiye genelinde yaygınlaşmaya devam ediyor.</p>
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `);
});

// --- GİRİŞ SAYFASI ---
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Kullanıcı Girişi - FRNSAN</title>
        </head>
        <body style="font-family:Arial, sans-serif; margin:0; background:#f4f6f9;">
            ${getHeader()}
            <div style="max-width:380px; margin:50px auto; background:white; padding:25px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.1);">
                <h2 style="text-align:center; margin-top:0;">Kullanıcı Girişi</h2>
                <form action="/login" method="POST">
                    <label><b>Kullanıcı Adı</b></label><br>
                    <input type="text" name="username" style="width:100%; padding:10px; margin:8px 0 15px 0; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;" required><br>
                    <label><b>Şifre</b></label><br>
                    <input type="password" name="password" style="width:100%; padding:10px; margin:8px 0 20px 0; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;" required><br>
                    <button type="submit" style="width:100%; padding:12px; background:#007bff; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">Giriş Yap</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// GİRİŞ KONTROLÜ (Kullanıcı: omerfrn | Şifre: omerf2000)
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'omerfrn' && password === 'omerf2000') {
        req.session.isLoggedIn = true;
        req.session.user = username;
        res.redirect('/admin');
    } else {
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h3 style="color:red;">❌ Hatalı Kullanıcı Adı veya Şifre!</h3>
                <a href="/login">Tekrar Giriş Yap</a>
            </div>
        `);
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- YÖNETİM PANELİ (GİZLİ - SADECE omerfrn İÇİN) ---
app.get('/admin', authMiddleware, (req, res) => {
    db.all("SELECT * FROM documents ORDER BY id DESC", [], (err, rows) => {
        let docsHtml = rows.map(doc => `
            <tr>
                <td style="padding:10px;">${doc.id}</td>
                <td style="padding:10px;"><b>${doc.title}</b></td>
                <td style="padding:10px;"><code style="background:#eee; padding:3px 6px;">${doc.verify_code}</code></td>
                <td style="padding:10px;"><img src="${doc.qr_path}" width="60"></td>
                <td style="padding:10px;"><a href="/uploads/${doc.filename}" target="_blank">Dosyayı Gör</a></td>
                <td style="padding:10px;"><a href="/verify/${doc.verify_code}" target="_blank">Doğrulama Bağlantısı</a></td>
            </tr>
        `).join('');

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Yönetim Paneli - FRNSAN</title>
            </head>
            <body style="font-family:Arial, sans-serif; margin:0; background:#f4f6f9;">
                ${getHeader(req.session.user)}
                <div style="max-width:1000px; margin:20px auto; padding:20px; background:white; border-radius:8px;">
                    <h2>📄 Belge Yönetim Paneli</h2>
                    <p>Hoş geldiniz, <b>${req.session.user}</b>. Buradan yeni belgeler yükleyip QR kod üretebilirsiniz.</p>
                    <hr>
                    <h3>Yeni Belge Yükle</h3>
                    <form action="/admin/upload" method="POST" enctype="multipart/form-data" style="background:#f8f9fa; padding:15px; border-radius:6px; border:1px solid #ddd;">
                        <input type="text" name="title" placeholder="Belge Başlığı / Açıklaması" style="padding:10px; width:95%; margin-bottom:10px;" required><br>
                        <input type="file" name="document" style="margin-bottom:15px;" required><br>
                        <button type="submit" style="padding:10px 20px; background:#28a745; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">Kaydet ve Otomatik QR Üret</button>
                    </form>
                    <hr>
                    <h3>Sistemdeki Kayıtlı Belgeler</h3>
                    <table border="1" cellpadding="5" style="border-collapse:collapse; width:100%; text-align:left;">
                        <tr style="background:#eee;">
                            <th>ID</th>
                            <th>Başlık</th>
                            <th>Doğrulama Kodu</th>
                            <th>QR</th>
                            <th>Belge</th>
                            <th>Açık Link</th>
                        </tr>
                        ${docsHtml || '<tr><td colspan="6" style="text-align:center;">Henüz yüklenmiş belge yok.</td></tr>'}
                    </table>
                </div>
            </body>
            </html>
        `);
    });
});

// BELGE YÜKLEME VE KOD/QR ÜRETME
app.post('/admin/upload', authMiddleware, upload.single('document'), async (req, res) => {
    const { title } = req.body;
    if (!req.file) return res.send("Lütfen bir dosya seçin.");
    const filename = req.file.filename;

    const verifyCode = 'DOC-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const verifyUrl = `${req.protocol}://${req.get('host')}/verify/${verifyCode}`;
    const qrFileName = `/qrcodes/${verifyCode}.png`;
    const qrFilePath = `./public${qrFileName}`;

    await QRCode.toFile(qrFilePath, verifyUrl);

    db.run(
        `INSERT INTO documents (title, filename, verify_code, qr_path) VALUES (?, ?, ?, ?)`,
        [title, filename, verifyCode, qrFileName],
        (err) => {
            if (err) return res.send("Veritabanı hatası.");
            res.redirect('/admin');
        }
    );
});

// --- HERKESE AÇIK BELGE DOĞRULAMA SAYFASI ---
app.get('/verify/:code?', (req, res) => {
    const code = req.params.code || req.query.code;

    if (!code) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Belge Doğrulama - FRNSAN</title>
            </head>
            <body style="font-family:Arial, sans-serif; margin:0; background:#f4f6f9;">
                ${getHeader(req.session.user)}
                <div style="max-width:450px; margin:50px auto; background:white; padding:25px; border-radius:8px; text-align:center;">
                    <h2>Belge Doğrulama Portalı</h2>
                    <p>Lütfen belgenizin üzerinde yer alan doğrulama kodunu giriniz.</p>
                    <form action="/verify" method="GET">
                        <input type="text" name="code" placeholder="Örn: DOC-A1B2C3" style="width:100%; padding:10px; margin-bottom:15px; box-sizing:border-box;" required>
                        <button type="submit" style="width:100%; padding:10px; background:#17a2b8; color:white; border:none; border-radius:4px; font-weight:bold;">Sorgula</button>
                    </form>
                </div>
            </body>
            </html>
        `);
    }

    db.get("SELECT * FROM documents WHERE verify_code = ?", [code.trim()], (err, doc) => {
        if (!doc) {
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
                <body style="font-family:Arial, sans-serif; margin:0; background:#f4f6f9;">
                    ${getHeader(req.session.user)}
                    <div style="max-width:450px; margin:50px auto; background:white; padding:25px; border-radius:8px; text-align:center;">
                        <h2 style="color:red; margin-top:0;">❌ Belge Bulunamadı</h2>
                        <p>Girdiğiniz doğrulama kodu sistemimizde kayıtlı değil.</p>
                        <a href="/verify" style="color:#007bff;">Yeniden Sorgula</a>
                    </div>
                </body>
                </html>
            `);
        }

        res.send(`
            <!DOCTYPE html>
            <html>
            <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
            <body style="font-family:Arial, sans-serif; margin:0; background:#f4f6f9;">
                ${getHeader(req.session.user)}
                <div style="max-width:550px; margin:40px auto; background:white; padding:25px; border-radius:8px; border:2px solid #28a745;">
                    <h2 style="color:#28a745; margin-top:0;">✔ Belge Orijinal ve Doğrulandı</h2>
                    <p><strong>Belge Adı:</strong> ${doc.title}</p>
                    <p><strong>Doğrulama Kodu:</strong> ${doc.verify_code}</p>
                    <p><strong>Sisteme Kayıt Tarihi:</strong> ${doc.created_at}</p>
                    <hr>
                    <p style="text-align:center;">
                        <a href="/uploads/${doc.filename}" target="_blank" style="background:#28a745; color:white; padding:12px 20px; text-decoration:none; border-radius:4px; font-weight:bold; display:inline-block;">Orijinal Belgeyi Görüntüle / İndir</a>
                    </p>
                </div>
            </body>
            </html>
        `);
    });
});

app.listen(PORT, () => {
    console.log(`FRNSAN Sistemi aktif: http://localhost:${PORT}`);
});

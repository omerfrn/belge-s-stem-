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

// Gerekli klasörleri oluştur
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
    secret: 'gizli_admin_anahtari_123',
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

const authMiddleware = (req, res, next) => {
    if (req.session.isLoggedIn) return next();
    res.redirect('/login');
};

app.get('/', (req, res) => {
    res.redirect('/admin');
});

// Admin Giriş Sayfası
app.get('/login', (req, res) => {
    res.send(`
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <div style="font-family:sans-serif; padding:20px; max-width:400px; margin:auto;">
            <h2>Yönetici Girişi</h2>
            <form action="/login" method="POST">
                <input type="password" name="password" placeholder="Şifre" style="width:100%; padding:10px; margin-bottom:10px;" required>
                <button type="submit" style="width:100%; padding:10px; background:#007bff; color:white; border:none;">Giriş Yap</button>
            </form>
        </div>
    `);
});

app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === 'admin123') { // GİRİŞ ŞİFRENİZ
        req.session.isLoggedIn = true;
        res.redirect('/admin');
    } else {
        res.send('Hatalı şifre! <a href="/login">Tekrar Dene</a>');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Admin Paneli
app.get('/admin', authMiddleware, (req, res) => {
    db.all("SELECT * FROM documents ORDER BY id DESC", [], (err, rows) => {
        let docsHtml = rows.map(doc => `
            <tr>
                <td>${doc.id}</td>
                <td>${doc.title}</td>
                <td><strong>${doc.verify_code}</strong></td>
                <td><img src="${doc.qr_path}" width="60"></td>
                <td><a href="/uploads/${doc.filename}" target="_blank">Gör</a></td>
                <td><a href="/verify/${doc.verify_code}" target="_blank">Link</a></td>
            </tr>
        `).join('');

        res.send(`
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <div style="font-family:sans-serif; padding:15px;">
                <h1>Yönetici Paneli</h1>
                <a href="/logout">Çıkış Yap</a>
                <hr>
                <h3>Yeni Belge Yükle</h3>
                <form action="/admin/upload" method="POST" enctype="multipart/form-data">
                    <input type="text" name="title" placeholder="Belge Adı" style="padding:8px; width:100%; margin-bottom:10px;" required><br>
                    <input type="file" name="document" style="margin-bottom:10px;" required><br>
                    <button type="submit" style="padding:10px; background:#28a745; color:white; border:none;">Kaydet ve QR Oluştur</button>
                </form>
                <hr>
                <h3>Yüklü Belgeler</h3>
                <table border="1" cellpadding="6" style="border-collapse:collapse; width:100%;">
                    <tr>
                        <th>ID</th>
                        <th>Başlık</th>
                        <th>Kod</th>
                        <th>QR</th>
                        <th>Dosya</th>
                        <th>Link</th>
                    </tr>
                    ${docsHtml}
                </table>
            </div>
        `);
    });
});

// Belge Kaydetme ve QR Kod Üretme
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

// Herkese Açık Doğrulama Sayfası
app.get('/verify/:code?', (req, res) => {
    const code = req.params.code || req.query.code;

    if (!code) {
        return res.send(`
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <div style="font-family:sans-serif; padding:20px; max-width:400px; margin:auto;">
                <h2>Belge Doğrulama</h2>
                <form action="/verify" method="GET">
                    <input type="text" name="code" placeholder="Doğrulama Kodunu Girin" style="width:100%; padding:10px; margin-bottom:10px;" required>
                    <button type="submit" style="width:100%; padding:10px; background:#17a2b8; color:white; border:none;">Sorgula</button>
                </form>
            </div>
        `);
    }

    db.get("SELECT * FROM documents WHERE verify_code = ?", [code.trim()], (err, doc) => {
        if (!doc) {
            return res.send(`
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <div style="font-family:sans-serif; padding:20px; text-align:center;">
                    <h2 style="color:red;">❌ Belge Bulunamadı</h2>
                    <p>Girdiğiniz kod sistemde kayıtlı değil.</p>
                    <a href="/verify">Yeniden Sorgula</a>
                </div>
            `);
        }

        res.send(`
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 20px auto; border: 2px solid #2e7d32; padding: 20px; border-radius: 8px;">
                <h2 style="color: #2e7d32; margin-top:0;">✔ Belge Doğrulandı</h2>
                <p><strong>Belge Adı:</strong> ${doc.title}</p>
                <p><strong>Doğrulama Kodu:</strong> ${doc.verify_code}</p>
                <p><strong>Tarih:</strong> ${doc.created_at}</p>
                <hr>
                <p><a href="/uploads/${doc.filename}" target="_blank" style="background:#2e7d32; color:white; padding:10px 15px; text-decoration:none; border-radius:4px; display:inline-block;">Orijinal Belgeyi Gör / İndir</a></p>
            </div>
        `);
    });
});

app.listen(PORT, () => {
    console.log(`Sunucu hazır: ${PORT}`);
});

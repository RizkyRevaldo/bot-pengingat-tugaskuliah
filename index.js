const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

// Konfigurasi Database SQLite
const db = new sqlite3.Database('./tugas_kuliah.db', (err) => {
    if (err) {
        console.error('Gagal terhubung ke database:', err.message);
    } else {
        console.log('Sukses terhubung ke database SQLite.');
        // Membuat tabel tugas jika belum ada
        db.run(`CREATE TABLE IF NOT EXISTS tugas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            matkul TEXT,
            deskripsi TEXT,
            deadline DATE,
            status TEXT DEFAULT 'belum'
        )`);
    }
});

// Menggunakan LocalAuth agar sesi tersimpan.
// Kamu hanya perlu scan QR satu kali.
const client = new Client({
    authStrategy: new LocalAuth()
});

// Menampilkan QR code di terminal saat pertama kali dijalankan
client.on('qr', (qr) => {
    qrcode.generate(qr, {small: true});
    console.log('Silakan scan QR code di atas menggunakan WhatsApp kamu!');
});

// Memberikan notifikasi jika bot berhasil masuk
client.on('ready', () => {
    console.log('Sukses! Bot sudah siap dan terhubung ke WhatsApp.');

    // Mengambil ID nomor WhatsApp kamu sendiri secara otomatis dari sesi
    const nomorSaya = client.info.wid._serialized;

    // JADWALKAN CRON JOB
    cron.schedule('0 7 * * *', () => {
        console.log('Mengecek tugas yang mendekati deadline...');
        
        // Ambil semua tugas yang statusnya masih 'belum'
        const querySql = `SELECT * FROM tugas WHERE status = 'belum'`;
        
        db.all(querySql, [], (err, rows) => {
            if (err) return console.error(err.message);
            
            // Ambil tanggal hari ini (tanpa jam agar perhitungannya akurat)
            const hariIni = new Date();
            hariIni.setHours(0, 0, 0, 0);

            rows.forEach((row) => {
                const tglDeadline = new Date(row.deadline);
                tglDeadline.setHours(0, 0, 0, 0);
                
                // Hitung selisih hari antara deadline dan hari ini
                const selisihWaktu = tglDeadline - hariIni;
                const selisihHari = Math.ceil(selisihWaktu / (1000 * 60 * 60 * 24)); 

                // Jika selisih hari adalah 7 hari atau kurang, dan belum lewat (>= 0)
                if (selisihHari <= 7 && selisihHari >= 0) {
                    let pesan = `🚨 *PENGINGAT TUGAS!* 🚨\n\n`;
                    pesan += `📚 Matkul: ${row.matkul}\n`;
                    pesan += `📝 Deskripsi: ${row.deskripsi}\n`;
                    pesan += `📅 Deadline: ${row.deadline}\n`;
                    
                    if (selisihHari === 0) {
                        pesan += `⚠️ *STATUS: DEADLINE HARI INI!*`;
                    } else {
                        pesan += `⏳ *STATUS: Sisa waktu H-${selisihHari}*`;
                    }
                    
                    // Bot mengirim pesan ke nomormu sendiri
                    client.sendMessage(nomorSaya, pesan);
                }
            });
        });
    });
});
// Fitur tes: jika kamu ketik "ping", bot akan membalas "pong"
client.on('message_create', message => {
    
    // 1. Fitur "ping" sekarang bisa diakses siapa saja (termasuk temanmu)
    if (message.body.toLowerCase() === 'ping') {
        message.reply('pong');
    }

    // 2. FITUR TAMBAH TUGAS (Bot mengecek awalan !tugas)
    if (message.body.toLowerCase().startsWith('!tugas')) {
        
        // KEAMANAN: Jika yang mengetik !tugas BUKAN kamu sendiri, bot akan menolak
        if (!message.fromMe) {
            message.reply('❌ Maaf, hanya pemilik yang bisa menambah tugas.');
            return; 
        }

        // Hapus kata "!tugas " (7 karakter) dan pecah berdasarkan "|"
        const teks = message.body.substring(7);
        const bagian = teks.split('|').map(item => item.trim());

        // Cek apakah data persis terbagi menjadi 3 bagian
        if (bagian.length === 3) {
            const matkul = bagian[0];
            const deskripsi = bagian[1];
            const deadline = bagian[2]; 

            const querySql = `INSERT INTO tugas (matkul, deskripsi, deadline) VALUES (?, ?, ?)`;
            
            db.run(querySql, [matkul, deskripsi, deadline], function(err) {
                if (err) {
                    message.reply('❌ Gagal menyimpan tugas ke database:\n' + err.message);
                } else {
                    message.reply(`✅ *TUGAS TERSIMPAN!*\n\n📚 Matkul: ${matkul}\n📝 Deskripsi: ${deskripsi}\n📅 Deadline: ${deadline}\n🆔 ID Tugas: ${this.lastID}`);
                }
            });
        } else {
            message.reply('⚠️ *Format Salah!*\n\nGunakan format persis seperti ini:\n!tugas Nama Matkul | Deskripsi Tugas | YYYY-MM-DD\n\nContoh:\n!tugas Cloud Computing | Bikin web KasirKu | 2026-10-10');
        }
    } 
    // FITUR TANDAI SELESAI
    if (message.body.toLowerCase().startsWith('!selesai ')) {
        if (!message.fromMe) return;
        
        // Mengambil ID tugas dari pesan (contoh: "!selesai 1")
        const idTugas = message.body.split(' ')[1];
        
        if (idTugas) {
            const updateSql = `UPDATE tugas SET status = 'selesai' WHERE id = ?`;
            db.run(updateSql, [idTugas], function(err) {
                if (err) {
                    message.reply('❌ Gagal memperbarui status tugas:\n' + err.message);
                } else if (this.changes === 0) {
                    message.reply('⚠️️ ID Tugas tidak ditemukan.');
                } else {
                    message.reply(`✅ Mantap! Tugas dengan ID ${idTugas} sudah ditandai SELESAI. Bot tidak akan mengingatkan tugas ini lagi.`);
                }
            });
        } else {
            message.reply('⚠️ Format salah. Gunakan: !selesai [ID Tugas]\nContoh: !selesai 1');
        }
    }
    // FITUR LIHAT DAFTAR TUGAS
    if (message.body.toLowerCase() === '!list') {
        // Keamanan: hanya merespons jika dari nomormu sendiri
        if (!message.fromMe) return;

        // Mengambil tugas yang belum selesai, diurutkan dari deadline terdekat
        const querySql = `SELECT * FROM tugas WHERE status = 'belum' ORDER BY deadline ASC`;
        
        db.all(querySql, [], (err, rows) => {
            if (err) {
                message.reply('❌ Gagal mengambil daftar tugas:\n' + err.message);
                return;
            }

            if (rows.length === 0) {
                message.reply('🎉 Mantap! Tidak ada tugas yang tertunda. Waktunya push rank Mobile Legends dengan tenang!');
            } else {
                let pesan = `📋 *DAFTAR TUGAS AKTIF* 📋\n\n`;
                
                rows.forEach((row, index) => {
                    pesan += `*${index + 1}. ${row.matkul}* (ID: ${row.id})\n`;
                    pesan += `   📝 Deskripsi: ${row.deskripsi}\n`;
                    pesan += `   📅 Deadline: ${row.deadline}\n\n`;
                });
                
                pesan += `💡 *Tips:* Ketik *!selesai [ID]* jika tugas sudah selesai dikerjakan.`;
                message.reply(pesan);
            }
        });
    }
});

client.initialize();
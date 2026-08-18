import { Router } from 'express';
import type { Request, Response } from 'express';
import { pool } from '../config/db.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// --- MULTER YAPILANDIRMASI ---
// Yüklenen dosyaların kaydedileceği klasör
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    // Çakışmaları önlemek için unique dosya ismi
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `cover-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Maksimum 5MB
});

// Google Books API üzerinden kitap arama (GET /api/books/search?q=seker+portakali)
router.get('/search', async (req: Request, res: Response) => {
  const { q } = req.query;

  if (!q || typeof q !== 'string') {
    res.status(400).json({ success: false, message: 'Arama terimi (q) gerekli.' });
    return;
  }

  try {
    const googleResponse = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5`
    );
    const data = await googleResponse.json();

    if (!data.items) {
      res.json({ success: true, data: [] });
      return;
    }

    const books = data.items.map((item: any) => {
      const volumeInfo = item.volumeInfo;
      let imageLink = volumeInfo.imageLinks?.thumbnail || volumeInfo.imageLinks?.smallThumbnail || '';
      if (imageLink.startsWith('http://')) {
        imageLink = imageLink.replace('http://', 'https://');
      }

      return {
        title: volumeInfo.title || 'Bilinmeyen Kitap',
        author: volumeInfo.authors ? volumeInfo.authors.join(', ') : 'Bilinmeyen Yazar',
        coverUrl: imageLink,
        pageCount: volumeInfo.pageCount || 0,
        isbn: volumeInfo.industryIdentifiers?.[0]?.identifier || null
      };
    });

    res.json({ success: true, data: books });
  } catch (error) {
    console.error('Google Books araması sırasında hata:', error);
    res.status(500).json({ success: false, message: 'Kitap araması başarısız.' });
  }
});

// 1. Kullanıcının Kütüphanesini Getir (Örn: GET /api/books?username=abla)
router.get('/', async (req: Request, res: Response) => {
  const { username } = req.query;

  try {
    const query = `
      SELECT 
        b.id AS book_id,
        b.title,
        b.author,
        b.cover_url,
        b.page_count,
        uba.status,
        uba.start_date,
        uba.finish_date,
        uba.rating,
        uba.notes,
        u.username,
        u.display_name
      FROM books b
      INNER JOIN user_book_activity uba ON b.id = uba.book_id
      INNER JOIN users u ON uba.user_id = u.id
      ${username ? 'WHERE u.username = $1' : ''}
      ORDER BY uba.updated_at DESC;
    `;

    const params = username ? [username] : [];
    const result = await pool.query(query, params);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Kitaplar çekilirken hata oluştu:', error);
    res.status(500).json({ success: false, message: 'Sunucu hatası' });
  }
});

// 2. Yeni Kitap Ekle ve Kullanıcıya Bağla (POST /api/books)
// upload.single('cover') eklendi: React Native FormData tarafındaki 'cover' ismiyle eşleşmeli!
router.post('/', upload.single('cover'), async (req: Request, res: Response) => {
  const { 
    title, 
    author, 
    coverUrl, 
    pageCount, 
    username, 
    status, 
    startDate, 
    finishDate, 
    rating, 
    notes 
  } = req.body;

  const client = await pool.connect();

  try {
    // 📷 Kapak resmi önceliği: Yüklenen Dosya > Gelen URL String'i > Boş Metin
    let finalCoverUrl = coverUrl || '';
    if (req.file) {
      // Sunucu domaininizle birleştirebilirsiniz (Örn: /uploads/cover-123.jpg)
      finalCoverUrl = `/uploads/${req.file.filename}`;
    }

    await client.query('BEGIN');

    // a. Kullanıcı ID'sini al
    const userResult = await client.query('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı' });
      return;
    }
    const userId = userResult.rows[0].id;

    // b. Kitabı `books` tablosuna ekle
    const bookResult = await client.query(
      `INSERT INTO books (title, author, cover_url, page_count) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [title, author, finalCoverUrl, Number(pageCount) || 0]
    );
    const bookId = bookResult.rows[0].id;

    // c. Okuma aktivitesini `user_book_activity` tablosuna ekle
    await client.query(
      `INSERT INTO user_book_activity (user_id, book_id, status, start_date, finish_date, rating, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId, 
        bookId, 
        status || 'TO_READ', 
        startDate || null, 
        finishDate || null, 
        Number(rating) || 0, 
        notes || ''
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'Kitap başarıyla eklendi', bookId });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Kitap eklenirken hata oluştu:', error);
    res.status(500).json({ success: false, message: 'Kitap eklenemedi' });
  } finally {
    client.release();
  }
});



// PUT /:id - Kitap Bilgilerini ve Kullanıcı Aktivitesini Güncelle
router.put('/:bookId', async (req: Request, res: Response) => {
    const { bookId } = req.params; // book_id
    const { title, author, status, rating, notes, username } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. `books` tablosunu güncelle (title, author)
        const updateBookQuery = `
            UPDATE books 
            SET 
                title = COALESCE($1, title),
                author = COALESCE($2, author)
            WHERE id = $3
            RETURNING *;
        `;
        const bookResult = await client.query(updateBookQuery, [
            title ?? null,
            author ?? null,
            id
        ]);

        if (bookResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'Güncellenecek kitap bulunamadı.'
            });
        }

        // 2. `user_book_activity` tablosunu güncelle (status, rating, notes)
        // Eğer username gönderildiyse kullanıcıya özel güncelleme yapar, gönderilmediyse ilgili book_id'ye ait aktiviteyi günceller
        const updateActivityQuery = `
            UPDATE user_book_activity
            SET 
                status = COALESCE($1, status),
                rating = COALESCE($2, rating),
                notes = COALESCE($3, notes),
                updated_at = NOW()
            WHERE book_id = $4
            ${username ? 'AND user_id = (SELECT id FROM users WHERE username = $5)' : ''}
            RETURNING *;
        `;

        const activityValues = username 
            ? [status ?? null, rating !== undefined ? Number(rating) : null, notes ?? null, id, username]
            : [status ?? null, rating !== undefined ? Number(rating) : null, notes ?? null, id];

        const activityResult = await client.query(updateActivityQuery, activityValues);

        await client.query('COMMIT');

        // Güncellenmiş birleşik veriyi dönüyoruz
        const updatedData = {
            ...bookResult.rows[0],
            ...activityResult.rows[0],
            book_id: bookResult.rows[0].id
        };

        return res.status(200).json({
            success: true,
            message: 'Kitap başarıyla güncellendi.',
            data: updatedData
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Update Book Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Kitap güncellenirken sunucu hatası oluştu.'
        });
    } finally {
        client.release();
    }
});

// GET yerine DELETE kullanıyoruz
// Kullanım: DELETE /books/12
router.delete('/:bookId', async (req: Request, res: Response) => {
  const { bookId } = req.params; // req.query yerine req.params

  // 1. Parametre kontrolü
  if (!bookId) {
    return res.status(400).json({
      success: false,
      message: 'bookId parametresi zorunludur.' // Düzeltildi
    });
  }

  try {
    const result = await pool.query(
      'DELETE FROM books WHERE id = $1 RETURNING *',
      [bookId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Silinecek kitap bulunamadı.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Kitap başarıyla silindi.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Kitap silinirken hata oluştu:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Sunucu hatası' 
    });
  }
});


export default router;
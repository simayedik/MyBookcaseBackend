import { Router,   } from 'express';
import type { Request, Response } from 'express';
import { pool } from '../config/db.js';


const router = Router();



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
router.post('/', async (req: Request, res: Response) => {
  const { title, author, coverUrl, pageCount, username, status, startDate, finishDate, rating, notes } = req.body;

  const client = await pool.connect();

  try {
    // Transaction Başlatıyoruz (Veri tutarlılığı için)
    await client.query('BEGIN');

    // a. Kullanıcı ID'sini al
    const userResult = await client.query('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı' });
      return;
    }
    const userId = userResult.rows[0].id;

    // b. Kitabı `books` tablosuna ekle
    const bookResult = await client.query(
      `INSERT INTO books (title, author, cover_url, page_count) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [title, author, coverUrl, pageCount || 0]
    );
    const bookId = bookResult.rows[0].id;

    // c. Okuma aktivitesini `user_book_activity` tablosuna ekle
    await client.query(
      `INSERT INTO user_book_activity (user_id, book_id, status, start_date, finish_date, rating, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, bookId, status || 'TO_READ', startDate || null, finishDate || null, rating || 0, notes || '']
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

export default router;
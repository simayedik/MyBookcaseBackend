import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Cloud (Neon/Supabase) bağlantılarında SSL şarttır
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('neon.tech');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log('⚡ PostgreSQL veritabanına başarıyla bağlandı.');
});

pool.on('error', (err) => {
  console.error('❌ Beklenmeyen veritabanı hatası:', err);
  process.exit(-1);
});
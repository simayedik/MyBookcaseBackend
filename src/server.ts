import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bookRoutes from './routes/bookRoutes.js';
import userRoutes from './routes/userRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());


app.use('/uploads', express.static('uploads'));
// Routes
app.use('/api/books', bookRoutes);
app.use('/api/users', userRoutes);

// Healthcheck Route (Sunucunun çalıştığını test etmek için)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', message: 'Kitaplığım API sorunsuz çalışıyor 🚀' });
});

app.listen(PORT, () => {
  console.log(`🚀 Sunucu http://localhost:${PORT} üzerinde çalışıyor.`);
});



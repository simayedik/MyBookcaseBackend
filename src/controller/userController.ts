import type{ Request, Response } from 'express';
import { pool } from '../config/db.js';

export const createUser = async(req: Request, res: Response) => {

    try{
        const {username,display_name } = req.body;
       
        if(!username || !display_name){
            res.status(400).json({
                success:false,
                message:'Kullanıcı adı ve görüntüleme adı gerekli.'});
            return;
        }

        const checkUser = await pool.query(
            'SELECT * FROM users WHERE username = $1',
             [username.toLowerCase().trim()]);

        if(checkUser.rows.length > 0){
            res.status(409).json({
                success:false,
                message:'Bu kullanıcı adı zaten mevcut.'});
            return;
        }     

        const newUser = await pool.query(
            'INSERT INTO users(username ,display_name) VALUES($1,$2) RETURNING *',
            [username.toLowerCase().trim(), display_name.trim()]
        );

        res.status(201).json({
            success:true,
            message:'Kullanıcı başarıyla oluşturuldu.',
            data:newUser.rows[0]
        });

    }
    catch (error) {
        console.error('Kullanıcı oluşturulurken hata oluştu:', error);
        res.status(500).json({
            success:false,
            message:'Sunucu hatası'
        });
    }
}

export const getUsers = async(req: Request, res: Response) => {
    try{
        const users = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
        res.status(200).json({
            success:true,  
            data:users.rows
        });
    }
    catch (error) {
        console.error('Kullanıcılar çekilirken hata oluştu:', error);
        res.status(500).json({
            success:false,
            message:'Sunucu hatası'
        });
    }
}
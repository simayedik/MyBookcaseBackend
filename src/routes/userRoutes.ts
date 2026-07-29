import { Router,   } from 'express';
import type { Request, Response } from 'express';
import { pool } from '../config/db.js';
import { createUser,  getUsers } from '../controller/userController.js';


const router = Router();


router.get('/',getUsers);
router.post('/',createUser);


export default router;
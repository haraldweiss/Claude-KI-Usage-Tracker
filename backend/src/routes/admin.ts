import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { listUsers, patchUser, deleteUser, adminStats } from '../controllers/adminController.js';

const router = Router();
router.use(requireAdmin);
router.get('/users', listUsers);
router.patch('/users/:id', patchUser);
router.delete('/users/:id', deleteUser);
router.get('/stats', adminStats);
export default router;

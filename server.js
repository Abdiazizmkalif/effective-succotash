const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { PrismaClient } = require('@prisma/client');

const adapter = new PrismaMariaDb({
    host: '127.0.0.1',
    user: 'root',
    password: '',            
    database: 'pubg_shop',   
    connectionLimit: 5
});

const prisma = new PrismaClient({ adapter });
const app = express();

// --- CONFIGURATION ---
const ADMIN_PASSWORD = "2159"; // CHANGE THIS PASSWORD!
const COOKIE_SECRET = "supersecrettokenkey"; 

app.use(cors());
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static('public')); 

// 1. Submit a new order (Public - No password needed)
app.post('/api/orders', async (req, res) => {
    try {
        const { playerId, playerName, fullName, phone, packageUc, priceEtb, paymentMethod } = req.body;
        const newOrder = await prisma.order.create({
            data: { playerId, playerName, fullName, phone, packageUc, priceEtb, paymentMethod }
        });
        res.status(201).json({ success: true, order: newOrder });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Admin Login Route
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        // Set a secure cookie that expires in 1 day
        res.cookie('admin_session', COOKIE_SECRET, { maxAge: 86400000, httpOnly: true });
        return res.json({ success: true });
    }
    res.status(401).json({ success: false, message: 'Incorrect Password' });
});

// 3. Admin Logout Route
app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('admin_session');
    res.json({ success: true });
});

// Middleware to protect admin endpoints
const requireAuth = (req, res, next) => {
    if (req.cookies.admin_session === COOKIE_SECRET) {
        return next();
    }
    res.status(403).json({ success: false, message: 'Unauthorized access' });
};

// 4. Fetch all orders (PROTECTED)
app.get('/api/orders', requireAuth, async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. Mark order as completed (PROTECTED)
app.put('/api/orders/:id/complete', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const updatedOrder = await prisma.order.update({
            where: { id: parseInt(id) },
            data: { status: 'COMPLETED' }
        });
        res.json({ success: true, order: updatedOrder });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
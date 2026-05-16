const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config(); 

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); 

// THIS LINE MUST COME BEFORE APP.USE()
const app = express(); 

// --- CONFIGURATION ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "super-secret-random-local-string-99X!";
const COOKIE_SECRET = process.env.COOKIE_SECRET || "supersecrettokenkey"; 

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
        res.cookie('admin_session', COOKIE_SECRET, { maxAge: 86400000, httpOnly: true, secure: process.env.NODE_ENV === 'production' });
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

app.get('/api/lookup-player/:id', async (req, res) => {
    const playerId = req.params.id;

    try {
        const response = await fetch(`https://check-id-game.p.rapidapi.com/api/rapid_api/cekpubgmobile/${playerId}`, {
            method: 'GET',
            headers: {
                'X-RapidAPI-Key': '16d66caaebmsh0666b97970080efp14991ajsnb0ffd9a9b2ae', 
                'X-RapidAPI-Host': 'check-id-game.p.rapidapi.com',
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        console.log("RapidAPI Raw Response:", data);

        // Notice the change here: checking if data.success is true and accessing data.data.username
        if (data && data.success && data.data && data.data.username) {
            return res.json({ success: true, nickname: data.data.username });
        } else {
            return res.json({ success: false, message: 'Character ID not found' });
        }
    } catch (error) {
        console.error('RapidAPI connection system failure:', error);
        return res.status(500).json({ success: false, message: 'Verification lookup down' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
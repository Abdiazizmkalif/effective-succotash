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
        // 1. Grab all incoming data from the request body
        const { playerId, playerName, fullName, phone, packageUc, priceEtb, paymentMethod } = req.body;

        // 2. Save it to your Prisma database ONCE using your real field names
        const newOrder = await prisma.order.create({
            data: { 
                playerId, 
                playerName, 
                fullName, 
                phone, 
                packageUc, 
                priceEtb, 
                paymentMethod,
                status: 'PENDING' // Assuming you have a default or status field
            }
        });

        // 3. Trigger your Telegram bot alert using your saved order data
        // We pass the data in an object format that your telegram function expects
        sendTelegramAlert({
            playerId: newOrder.playerId,
            nickname: newOrder.playerName, // maps playerName to the telegram nickname field
            packageType: newOrder.packageUc, // maps packageUc to packageType
            price: newOrder.priceEtb,
            transactionRef: newOrder.paymentMethod // or whatever field tracks their reference code
        }); 

        // 4. Send ONE final success response back to the browser screen
        return res.status(201).json({ 
            success: true, 
            message: 'Order submitted for verification!',
            order: newOrder 
        });

    } catch (error) {
        console.error("Order submission route crashed:", error);
        return res.status(500).json({ success: false, error: error.message });
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
app.put('/api/orders/:id/complete', async (req, res) => {
    // Convert the text parameter id (like "34") into a real integer number (34)
    const id = Number(req.params.id);

    // Safety check: if conversion fails, stop immediately
    if (isNaN(id)) {
        return res.status(400).json({ success: false, error: 'Invalid order ID format.' });
    }

    try {
        // 1. Update the current active order to COMPLETED state using the numeric ID
        const updatedOrder = await prisma.order.update({
            where: { id: id }, // Prisma will be perfectly happy now!
            data: { status: 'COMPLETED' }
        });

        // 2. Perform background tracking calculations if a referral code exists
        if (updatedOrder.referredBy) {
            try {
                // Count completed transactions credited to this specific referrer
                const successfulReferralsCount = await prisma.order.count({
                    where: {
                        referredBy: updatedOrder.referredBy,
                        status: 'COMPLETED'
                    }
                });

                // Trigger Milestone Alert if their referrals hit a multiple of 5
                if (successfulReferralsCount > 0 && successfulReferralsCount % 5 === 0) {
                    if (typeof sendTelegramRewardAlert === 'function') {
                        await sendTelegramRewardAlert(updatedOrder.referredBy, successfulReferralsCount);
                    } else {
                        console.warn("Warning: sendTelegramRewardAlert function is missing in server.js");
                    }
                }
            } catch (referralError) {
                console.error("Referral tracking calculation background step failed:", referralError);
            }
        }

        return res.json({ success: true, order: updatedOrder });

    } catch (error) {
        console.error("Dashboard complete route failed:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/lookup-player/:id', async (req, res) => {
    const playerId = req.params.id;

    try {
        const response = await fetch(`https://id-game-checker.p.rapidapi.com/pubgm-global/${playerId}`, {
            method: 'GET',
            headers: {
                'X-RapidAPI-Key': '16d66caaebmsh0666b97970080efp14991ajsnb0ffd9a9b2ae', 
                // ✅ FIXED: Matched host string exactly to the API gateway documentation
                'X-RapidAPI-Host': 'id-game-checker.p.rapidapi.com',
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        console.log("RapidAPI Raw Response:", data);

        // Map the API's specific username field back to your client-side framework
        if (response.ok && data) {
            // Note: Check your server terminal console log to ensure if the key is 'username', 'nickname', or 'name'
            const inGameName = data.username || data.nickname || data.name; 
            
            if (inGameName) {
                return res.json({ success: true, nickname: inGameName });
            }
        }
        
        return res.json({ success: false, message: 'Player not found' });

    } catch (error) {
        console.error("Verification Route Error:", error);
        return res.status(500).json({ success: false, message: 'Internal server lookup failure' });
    }
});

// Send a clean, formatted alert straight to your Telegram app
async function sendTelegramAlert(orderData) {
    // Paste your real keys here
    const BOT_TOKEN = '8343338910:AAGqJHGN_W671Ed13t5q4HB7Fbgp-rSBdjQ';
    const CHAT_ID = '7481472740'; 
    // Change this URL to match your real live website link
    const DASHBOARD_URL = 'https://pubg-uc-shop.onrender.com/admin.html'; // Update with your actual URL path!

    const message = `🎮 *New UC Order Received!*\n\n` +
                    `🆔 *Player ID:* \`${orderData.playerId}\`\n` +
                    `👤 *In-Game Name:* ${orderData.nickname}\n` +
                    `📦 *Package:* ${orderData.packageType}\n` +
                    `💰 *Price:* ${orderData.price} ETB\n` +
                    `📝 *Method:* ${orderData.transactionRef}\n\n` +
                    `🔗 *[Click Here to Open Admin Dashboard](${DASHBOARD_URL})*`;

    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });
        console.log("Telegram notification sent successfully!");
    } catch (err) {
        console.error("Failed sending message via Telegram API:", err);
    }
}

async function sendTelegramRewardAlert(referrerId, totalCount) {
    const BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
    const CHAT_ID = 'YOUR_PERSONAL_CHAT_ID'; 

    const message = `🎁 *REFERRAL MILESTONE REACHED!* 🎁\n\n` +
                    `👤 *Referrer Player ID:* \`${referrerId}\`\n` +
                    `📊 *Total Successful Invites:* ${totalCount}\n\n` +
                    `⚠️ *ACTION REQUIRED:* Load a free *30 UC* reward pack to this Player ID immediately!`;

    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'Markdown' })
        });
    } catch (err) {
        console.error("Telegram milestone transmission failed:", err);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
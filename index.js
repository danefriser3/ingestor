import express from "express";
import pool from "./db.js";

const app = express();
app.use(express.json({ type: "*/*" }));

// Simple health endpoints for Railway/Nixpacks
app.get("/", (req, res) => {
    res.status(200).send("OK");
});

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// Utility to return brief, concise error messages
const briefErrorMessage = (err) => {
    const code = err?.code;
    switch (code) {
        case "ECONNREFUSED":
            return "Servizio non raggiungibile";
        case "ETIMEDOUT":
            return "Connessione scaduta";
        case "EHOSTUNREACH":
            return "Host non raggiungibile";
        case "ENOTFOUND":
            return "Indirizzo non trovato";
        case "EAI_AGAIN":
            return "DNS non disponibile";
        default:
            return "Errore";
    }
};

// Extract a readable original error message (short, no noisy JSON)
const readableErrorMessage = (err) => {
    const raw = err?.message || err?.toString?.() || "";
    const msg = typeof raw === "string" ? raw : "";
    // Trim very long messages to keep response concise
    return msg.length > 300 ? msg.slice(0, 300) + "…" : msg || "";
};

app.post("/minio-events", async (req, res) => {
    try {
        const records = req.body?.Records || [];
        for (const record of records) {
            const bucket = record.s3.bucket.name;
            const key = decodeURIComponent(record.s3.object.key);

            console.log("📦 Evento MinIO ricevuto:", bucket, key);

            // Leggi JSON da AWS S3
            const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
            const s3 = new S3Client({
                region: process.env.AWS_REGION || "eu-north-1",
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                },
            });

            const data = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const body = await data.Body.transformToString();
            const products = JSON.parse(body);
            console.log(`📄 Letti ${products.length} prodotti da ${key}`);

            // Inserisci i prodotti nel DB
            if (products.length > 0) {
                const now = new Date();
                const today = now.toISOString().split('T')[0];
                const currentHour = now.getHours();
                
                // Determina quale slot orario dovrebbe essere usato
                let targetHour;
                if (currentHour >= 21) targetHour = 21;
                else if (currentHour >= 15) targetHour = 15;
                else if (currentHour >= 9) targetHour = 9;
                else targetHour = null;
                
                if (!targetHour) {
                    console.log(`⏭️ Fuori orario di esecuzione (9, 15, 21)`);
                    continue;
                }

                // Controlla se esistono già dati per oggi e questo slot orario
                const checkQuery = `
                    SELECT COUNT(*) as count 
                    FROM products 
                    WHERE DATE(created_at) = CURRENT_DATE AND EXTRACT(hour FROM created_at) = $1
                `;
                const checkResult = await pool.query(checkQuery, [targetHour]);
                
                if (checkResult.rows[0].count > 0) {
                    console.log(`⏭️ Dati già presenti per oggi ${today} alle ore ${targetHour}`);
                    continue;
                }

                const values = [];
                const placeholders = [];
                products.forEach((p, i) => {
                    placeholders.push(`($${i * 8 + 1}, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8})`);
                    values.push(
                        p.name || null,
                        p.price || null,
                        p.brand || null,
                        p.sku || null,
                        p.currency || null,
                        p.source || null,
                        p.category || null,
                        p.image || null
                    );
                });

                await pool.query(`TRUNCATE TABLE products RESTART IDENTITY`);
                await pool.query(`
                    INSERT INTO products (name, price, brand, sku, currency, source, category, image)
                    VALUES ${placeholders.join(", ")}
                    ON CONFLICT (sku, source) DO NOTHING
                `, values);
                console.log(`✅ Inseriti ${products.length} prodotti nel DB per ${today} ore ${currentHour}`);
            }

            console.log(`✅ Salvati ${products.length} prodotti nel DB`);
        }

        res.sendStatus(200);
    } catch (err) {
        console.error("Errore ingestor:", err);
        const connErrors = ["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN"];
        const status = connErrors.includes(err?.code) ? 502 : 500;
        res.status(status).json({
            error: briefErrorMessage(err),
            message: readableErrorMessage(err),
            code: err?.code || err?.name || undefined,
        });
    }
});

const PORT = process.env.PORT || 4000;
const HOST = "0.0.0.0";
const server = app.listen(PORT, HOST, () => {
    console.log(`🚀 Ingestor in ascolto su http://${HOST}:${PORT}`);
});

// Graceful shutdown for Railway
const shutdown = (signal) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    server.close(() => {
        console.log("HTTP server closed");
        try {
            pool.end().then(() => {
                console.log("DB pool closed");
                process.exit(0);
            });
        } catch (e) {
            console.error("Error closing DB pool", e);
            process.exit(1);
        }
    });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

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

            // Leggi JSON da MinIO
            const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
            const s3 = new S3Client({
                endpoint: process.env.MINIO_ENDPOINT || "https://minio-hfis.onrender.com", // MinIO online
                region: process.env.MINIO_REGION || "us-east-1",
                credentials: {
                    accessKeyId: process.env.MINIO_ACCESS_KEY || "minio",
                    secretAccessKey: process.env.MINIO_SECRET_KEY || "miniopass",
                },
                forcePathStyle: true,
            });


            const data = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const body = await data.Body.transformToString();
            const products = JSON.parse(body);
            console.log(`📄 Letti ${products.length} prodotti da ${key}`);

            // Inserisci i prodotti nel DB
            if (products.length > 0) {
                const values = [];
                const placeholders = [];
                const date = new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" });
                products.forEach((p, i) => {
                    // i è l'indice del prodotto
                    // ogni riga ha 8 colonne: name, price, brand, sku, currency, source, category, image
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

                const query = `
        TRUNCATE TABLE products RESTART IDENTITY;
    `;

                await pool.query(query);

                const query1 = `
        INSERT INTO products (name, price, brand, sku, currency, source, category, image)
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (sku, source) DO NOTHING
    `;

                await pool.query(query1, values);
                console.log(`✅ Inseriti ${products.length} prodotti nel DB`);
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

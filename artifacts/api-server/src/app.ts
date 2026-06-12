import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import { rateLimit } from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Brute force protection for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Increased to 20 to be more permissive during testing
  message: { error: "كثير من محاولات تسجيل الدخول، يرجى المحاولة لاحقاً بعد 15 دقيقة" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Protect sensitive endpoints
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "كثير من الطلبات، يرجى المحاولة لاحقاً" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Throttle public account creation
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "كثير من محاولات إنشاء الحساب، يرجى المحاولة لاحقاً بعد 15 دقيقة" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/register", registerLimiter);
app.use("/api/accounts/:id/reveal-password", sensitiveLimiter);

const serverPort = process.env.PORT ?? "5000";
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") ?? [
  `http://localhost:${serverPort}`,
  `http://127.0.0.1:${serverPort}`,
  "http://localhost:5173",
  "http://localhost:8080",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // In development, allow all origins to avoid CORS issues with localhost/127.0.0.1/replit
      if (process.env.NODE_ENV !== "production") {
        callback(null, true);
        return;
      }

      if (
        !origin || 
        allowedOrigins.includes(origin) || 
        origin.endsWith(".replit.dev") || 
        origin.endsWith(".repl.co")
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", router);

// API 404 handler
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "الطلب غير موجود" });
});

const publicDir = path.resolve(process.cwd(), "public");
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("/{*path}", (_req, res, next) => {
    if (_req.path.startsWith("/api")) {
      return next();
    }
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

export default app;

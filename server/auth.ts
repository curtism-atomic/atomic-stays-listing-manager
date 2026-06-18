import session from "express-session";
import ConnectSQLite from "connect-sqlite3";
import type { Express, Request, Response, NextFunction } from "express";

const SQLiteStore = ConnectSQLite(session);

const TEAM_PASSWORD = process.env.APP_PASSWORD || "AtomicStays2026";
const SESSION_SECRET = process.env.SESSION_SECRET || "atomic-stays-session-secret-2026";

export function setupAuth(app: Express) {
  // Trust Render/Cloudflare proxy so secure cookies work behind TLS termination
  app.set("trust proxy", 1);

  app.use(
    session({
      name: "sid",
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: new SQLiteStore({ db: "sessions.db", dir: ".", table: "sessions" }) as any,
      cookie: {
        secure: "auto",
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    })
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Allow login/logout endpoints through
  if (req.path === "/api/auth/login" || req.path === "/api/auth/logout" || req.path === "/api/auth/status") {
    return next();
  }
  // Allow static assets through (they don't contain sensitive data)
  if (req.path.startsWith("/assets/") || req.path === "/favicon.ico") {
    return next();
  }
  const sess = req.session as any;
  if (sess?.authenticated) {
    return next();
  }
  // For API routes, return 401
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  // For page routes, serve index.html — the client will show the login screen
  return next();
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/login", (req: Request, res: Response) => {
    const { password } = req.body;
    if (password === TEAM_PASSWORD) {
      (req.session as any).authenticated = true;
      req.session.save((err) => {
        if (err) return res.status(500).json({ success: false, message: "Session error" });
        return res.json({ success: true });
      });
    } else {
      return res.status(401).json({ success: false, message: "Incorrect password" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/status", (req: Request, res: Response) => {
    const sess = req.session as any;
    res.json({ authenticated: !!sess?.authenticated });
  });
}

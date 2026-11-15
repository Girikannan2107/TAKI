/** Client-safe configuration. Only NEXT_PUBLIC_* values may be read here. */
export type AppMode = "demo" | "live";

const raw = process.env.NEXT_PUBLIC_APP_MODE;

/** The app runs in demo mode unless explicitly configured for live services. */
export const appMode: AppMode = raw === "live" ? "live" : "demo";
export const isDemo = appMode === "demo";
